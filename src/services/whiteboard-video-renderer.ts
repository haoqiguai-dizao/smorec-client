import type { BoardRecording } from '../../shared/whiteboard/types';
import { sourceSize } from './camera-effects/canvas';
import { mediaFrameIdentity } from './media-frame-identity';

export function paintBoardVideo(ctx: CanvasRenderingContext2D, frame: CanvasImageSource,
  recording: BoardRecording, time: number, width: number, height: number): void {
  const frameTime = mediaFrameIdentity(frame)?.time;
  const sourceTime = frameTime === undefined ? time : frameTime - (recording.video?.offset ?? 0);
  const crops = recording.video?.crops ?? [];
  let low = 0, high = crops.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (crops[mid].t <= sourceTime + .001) low = mid + 1; else high = mid;
  }
  const crop = crops[Math.max(0, low - 1)], size = sourceSize(frame);
  if (!crop) { ctx.drawImage(frame, 0, 0, width, height); return; }
  const b = crop.bounds;
  ctx.drawImage(frame, b.x * size.width, b.y * size.height, b.width * size.width, b.height * size.height,
    0, 0, width, height);
}
