import type { BoardEvent, BoardRecording } from './types';

type Layout = Extract<BoardEvent['action'], { kind: 'layout' }>;
const layouts = new WeakMap<BoardRecording, { length: number; list: { t: number; action: Layout }[] }>();

/** Layout queries never replay the vector undo history or disturb its playback cursor. */
export function boardLayoutFrameAt(recording: BoardRecording, time: number) {
  let cached = layouts.get(recording);
  if (!cached || cached.length !== recording.events.length) {
    cached = { length: recording.events.length,
      list: recording.events.flatMap(event => event.action.kind === 'layout' ? [{ t: event.t, action: event.action }] : []) };
    layouts.set(recording, cached);
  }
  const list = cached.list;
  let low = 0, high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (list[mid].t <= time) low = mid + 1; else high = mid;
  }
  return list[low - 1];
}
export function boardLayoutAt(recording: BoardRecording, time: number): Layout | undefined {
  return boardLayoutFrameAt(recording, time)?.action;
}
