import { chooseExportEncoding } from './export-encoding';
import type { Project } from '../../shared/types';
import type { ExportVideoApi } from '../../shared/export-render';
import { getOutputDuration } from '../../shared/timeline';
import { getCanvasSize, renderFrame } from './compositor';
import { abortError } from './media';
import { decodeFrames, shouldDecodeCamera } from './decode-video';
import { hasFaceEffects } from '../../shared/beauty';
import { disposeWebcamEffects, prepareWebcamEffects } from './webcam-compositor';
import { cameraEffectsAt } from '../../shared/camera-effects';
import { abortableOperation } from './abortable-operation';
import { getExportFrameBatchSize, isSupportedExportSize } from '../../shared/canvas';
import { CompositionBackgroundCache } from './composition-backgrounds';
import { disposeCompositionDecoration } from './compositor-decoration';
import { waitForEncoderCapacity } from './export-encoder-capacity';
import { prepareBoardImages } from './whiteboard-images';

export interface ExportProgress { progress: number; phase: string }

export async function exportVideo(api: ExportVideoApi, project: Project, onProgress: (progress: ExportProgress) => void, signal: AbortSignal): Promise<string | null> {
  const { width, height } = getCanvasSize(project);
  if (!isSupportedExportSize({ width, height })) throw new Error(`导出尺寸 ${width} × ${height} 超出支持范围`);
  const batchSize = getExportFrameBatchSize({ width, height });
  const fps = project.fps;
  const duration = getOutputDuration(project.clips);
  const frames = Math.ceil(duration * fps);
  if (!frames) throw new Error('请至少保留一个视频片段');
  if (!('VideoEncoder' in window)) throw new Error('当前环境不支持视频编码，请使用桌面版');
  const status = await abortableOperation(api.getStatus(), signal);
  const encoding = await abortableOperation(chooseExportEncoding(width, height, fps, status.platform), signal);
  const config = encoding.config;
  onProgress({ progress: 0, phase: '准备声音与保存位置' });
  const cancelPreparation = () => { void api.cancelExportPreparation().catch(() => undefined); };
  signal.addEventListener('abort', cancelPreparation, { once: true });
  let session;
  try {
    if (signal.aborted) throw abortError();
    await abortableOperation(prepareBoardImages(project.id, project.whiteboard), signal);
    session = await api.exportStart(project, { width, height, fps, frames, ...(encoding.codec !== 'vp8' ? { codec: encoding.codec } : {}) });
  } finally { signal.removeEventListener('abort', cancelPreparation); }
  if (!session && signal.aborted) throw abortError();
  if (!session) return null;
  let encoder: VideoEncoder | undefined;
  let failure: Error | null = null;
  let writes: Promise<void> = Promise.resolve();
  let frameIndex = 0;
  let pendingBytes = 0, pendingPackets = 0, lastProgress = 0;
  let context: CanvasRenderingContext2D | null = null;
  let canceling: Promise<void> | undefined;
  const backgrounds = new CompositionBackgroundCache();
  const cancelBackend = () => canceling ??= api.exportCancel(session.id).catch(() => undefined);
  const closeEncoder = () => { if (encoder && encoder.state !== 'closed') encoder.close(); };
  const cancel = () => {
    // Closing now also releases an encoder whose flush promise never settles.
    try { closeEncoder(); } finally { void cancelBackend(); }
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw abortError();
    onProgress({ progress: 0, phase: '准备原始画面' });
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    if (!context) throw new Error('无法创建导出画布');
    encoder = new VideoEncoder({
      output: (chunk) => {
        const packet = new ArrayBuffer(chunk.byteLength + 12);
        const header = new DataView(packet);
        header.setUint32(0, chunk.byteLength, true);
        header.setBigUint64(4, BigInt(frameIndex++), true);
        chunk.copyTo(new Uint8Array(packet, 12));
        pendingBytes += packet.byteLength; pendingPackets++;
        // Serialize IPC writes to preserve IVF packet order and apply encoder backpressure.
        writes = writes.then(async () => {
          if (signal.aborted) throw abortError();
          await api.exportAppend(session.id, packet);
        }).catch((error: Error) => { failure = error; }).finally(() => { pendingBytes -= packet.byteLength; pendingPackets--; });
      },
      error: (error) => { failure = error; },
    });
    encoder.configure(config);
    const faceLookahead = shouldDecodeCamera(project) && (hasFaceEffects(project.camera?.effects)
      || project.camera?.effectKeyframes?.some(frame => hasFaceEffects(frame.effects)));
    const decodedFrames = decodeFrames(project, frames, fps, signal, async ({ webcam, sourceTime, index }) => {
      if (webcam && project.camera) await prepareWebcamEffects(context!, webcam, cameraEffectsAt(project.camera, sourceTime), index);
    }, faceLookahead ? 3 : 1);
    for await (const { canvas: decoded, webcam, whiteboard, sourceTime, index } of decodedFrames) {
      if (signal.aborted) throw abortError();
      if (failure) throw failure;
      if (encoding.hardware) {
        await waitForEncoderCapacity(encoder, Math.max(2, batchSize), signal, () => failure);
        if (pendingBytes >= 8 * 1024 * 1024 || pendingPackets >= 16) await abortableOperation(writes, signal);
        if (failure) throw failure;
      }
      const background = await abortableOperation(backgrounds.prepare(project, sourceTime, signal), signal);
      renderFrame(context, decoded, project, sourceTime, width, height, webcam, 'source', background, undefined, whiteboard);
      // Read back before the software encoder queue. The canvas-input path showed
      // multi-second flush waits in the full editor; keep the copy per frame.
      const pixels = encoding.hardware ? undefined : context.getImageData(0, 0, width, height);
      const timestamp = Math.round(index * 1_000_000 / fps), duration = Math.round(1_000_000 / fps);
      const frame = encoding.hardware ? new VideoFrame(canvas, { timestamp, duration }) : new VideoFrame(pixels!.data, {
        format: 'RGBA', codedWidth: width, codedHeight: height,
        timestamp: Math.round(index * 1_000_000 / fps), duration: Math.round(1_000_000 / fps),
        // Match the opaque sRGB canvas frame, including full-range RGB samples.
        colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
      });
      try { encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 }); } finally { frame.close(); }
      if (!encoding.hardware && (index + 1) % batchSize === 0) {
        await abortableOperation(encoder.flush(), signal);
        await abortableOperation(writes, signal);
      }
      const now = performance.now();
      if (now - lastProgress >= 100 || index + 1 === frames) {
        onProgress({ progress: (index + 1) / frames * 0.94, phase: `正在渲染 ${index + 1} / ${frames} 帧` }); lastProgress = now;
      }
    }
    await abortableOperation(encoder.flush(), signal);
    await abortableOperation(writes, signal);
    if (failure) throw failure;
    if (signal.aborted) throw abortError();
    onProgress({ progress: 0.96, phase: '正在合成声音与 MP4' });
    const path = await abortableOperation(api.exportFinish(session.id), signal);
    if (signal.aborted) throw abortError();
    onProgress({ progress: 1, phase: '导出完成' });
    return path;
  } catch (error) {
    const cleanup = cancelBackend();
    // The backend owns process cleanup; a stalled IPC must not trap a canceled UI.
    if (!signal.aborted) await abortableOperation(cleanup, signal);
    throw signal.aborted ? abortError() : error;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (context) { disposeWebcamEffects(context); disposeCompositionDecoration(context); }
    backgrounds.dispose();
    closeEncoder();
  }
}
