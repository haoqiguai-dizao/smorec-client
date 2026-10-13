import type { Project } from '../../shared/types';
import { outputToSourceTime } from '../../shared/timeline';
import { abortError } from './media';
import { abortableOperation } from './abortable-operation';
import { markMediaFrame } from './media-frame-identity';
import { frameContentAt } from '../../shared/frame-content';
import { boardVideoVisible, embeddedBoardVisible } from '../../shared/whiteboard/video';

export function shouldDecodeCamera(project: Project): boolean {
  if (!project.media.camera || !project.camera) return false;
  return project.camera.enabled || Boolean(project.compositions?.some(segment => segment.camera?.visible === true
    && project.clips.some(clip => clip.start < segment.end && clip.end > segment.start)));
}

/** The pool covers every retained output frame, including all speculative reads. */
async function* decodeTrack(url: string, times: () => Generator<number>, signal: AbortSignal, poolSize: number) {
  const { Input, UrlSource, MP4, WEBM, CanvasSink } = await import('mediabunny');
  const input = new Input({ formats: [MP4, WEBM], source: new UrlSource(url, {
    maxCacheSize: 16 * 1024 * 1024, getRetryDelay: () => null,
  }) });
  const cancel = () => input.dispose();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw abortError();
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error('此视频无法逐帧解码，请先转换为 H.264 MP4');
    const first = await track.getFirstTimestamp();
    const last = await track.computeDuration();
    const sink = new CanvasSink(track, { poolSize });
    function* timestamps() {
      for (const time of times()) yield Math.max(first, Math.min(last - 0.000001, time));
    }
    let index = 0;
    for await (const result of sink.canvasesAtTimestamps(timestamps())) {
      if (signal.aborted) throw abortError();
      if (!result) throw new Error(`无法读取第 ${index + 1} 帧`);
      markMediaFrame(result.canvas, input, result.timestamp);
      yield { canvas: result.canvas, last };
      index++;
    }
  } finally {
    signal.removeEventListener('abort', cancel); input.dispose();
  }
}

export interface DecodedFrame {
  canvas?: CanvasImageSource;
  webcam?: CanvasImageSource;
  whiteboard?: CanvasImageSource;
  sourceTime: number;
  index: number;
}

export async function* decodeFrames(project: Project, frames: number, fps: number, signal: AbortSignal,
  prepare?: (frame: DecodedFrame) => Promise<void>, lookahead: 1 | 3 = 1) {
  function* times(layer: 'screen' | 'camera' | 'whiteboard', offset = 0) {
    for (let index = 0; index < frames; index++) {
      const time = outputToSourceTime(project.clips, index / fps);
      const visible = layer === 'whiteboard' ? boardVideoVisible(project, time)
        : frameContentAt(project, time)[layer] || layer === 'screen' && embeddedBoardVisible(project, time);
      if (visible) yield time + offset;
    }
  }
  const decoding = new AbortController();
  const cancel = () => decoding.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const screen = decodeTrack(project.media.screen, () => times('screen'), decoding.signal, lookahead + 1);
  const camera = shouldDecodeCamera(project)
    ? decodeTrack(project.media.camera!, () => times('camera', project.camera!.offset), decoding.signal, lookahead + 1) : undefined;
  const whiteboard = project.media.whiteboard && project.whiteboard?.video
    ? decodeTrack(project.media.whiteboard, () => times('whiteboard', project.whiteboard!.video!.offset), decoding.signal, lookahead + 1) : undefined;
  let completed = false;
  const read = async (index: number) => {
    const sourceTime = outputToSourceTime(project.clips, index / fps), content = frameContentAt(project, sourceTime);
    const boardVisible = boardVideoVisible(project, sourceTime);
    if (boardVisible && !whiteboard) throw new Error('完整白板视频缺失，请重新打开工程');
    const [decoded, webcam, board] = await Promise.all([
      content.screen || embeddedBoardVisible(project, sourceTime) ? screen.next() : undefined,
      content.camera ? camera?.next() : undefined,
      boardVisible ? whiteboard?.next() : undefined,
    ]);
    if (decoded?.done) throw new Error('屏幕视频提前结束');
    if (webcam?.done) throw new Error('摄像头视频提前结束');
    if (board?.done) throw new Error('白板界面视频提前结束');
    const cameraTime = sourceTime + (project.camera?.offset ?? 0);
    const frame = { canvas: decoded?.value.canvas, webcam: webcam && cameraTime >= 0 && cameraTime < webcam.value.last + .05
      ? webcam.value.canvas : undefined, whiteboard: board?.value.canvas, sourceTime, index };
    // Preparation shares the decoding bound, including cancellation and failure.
    await prepare?.(frame);
    return frame;
  };
  try {
    if (signal.aborted) throw abortError();
    if (frames <= 0) return;
    const schedule = (index: number) => {
      const pending = read(index);
      void pending.catch(() => undefined);
      return pending;
    };
    const pending = Array.from({ length: Math.min(frames, lookahead) }, (_, index) => schedule(index));
    for (let index = 0; index < frames; index++) {
      const frame = await abortableOperation(pending.shift()!, signal);
      if (index + lookahead < frames) pending.push(schedule(index + lookahead));
      yield frame;
    }
    completed = true;
  } finally {
    signal.removeEventListener('abort', cancel);
    // Release inputs before returning iterators: return() queues behind a pending next().
    cancel();
    const cleanup = Promise.allSettled([screen.return(), camera?.return(), whiteboard?.return()]);
    // An early consumer exit must not wait behind a stalled speculative next(). Inputs are already disposed.
    if (completed && !signal.aborted) await abortableOperation(cleanup, signal);
  }
}
