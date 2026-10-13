import type { CursorSample, InputActivity } from '../types';
import { type BoardView, type BoardAction, type BoardBounds,
  type BoardElement, type BoardEvent, type BoardPoint, type BoardRecording } from '../whiteboard/types';
import { boardViewport } from '../whiteboard/viewport';

type LayoutEvent = BoardEvent & { action: Extract<BoardEvent['action'], { kind: 'layout' }> };
const isLayout = (event: BoardEvent): event is LayoutEvent => event.action.kind === 'layout';

function elementPoint(item: BoardElement): BoardPoint | undefined {
  if (item.kind === 'shape' || item.kind === 'image') return { x: item.x + item.width / 2, y: item.y + item.height / 2 };
  if (item.kind === 'text') return item.text ? { x: item.x + 48, y: item.y + item.size / 2 } : undefined;
  if (item.kind === 'line') return { x: (item.start.x + item.end.x) / 2, y: (item.start.y + item.end.y) / 2 };
  return item.points.at(-1);
}

function actionPoint(action: BoardAction): { key: string; point: BoardPoint } | undefined {
  if (action.kind === 'focus') return { key: 'speech', point: action.point };
  if (action.kind === 'connect-node') return { key: action.node.id, point: elementPoint(action.node)! };
  if (action.kind === 'replace' || action.kind === 'reveal') {
    const point = elementPoint(action.element);
    return point && { key: action.element.id, point };
  }
  if (action.kind === 'erase') return { key: action.gesture, point: action.points.at(-1)! };
  if (action.kind === 'stroke' || action.kind === 'shape' || action.kind === 'image'
    || action.kind === 'line' || action.kind === 'text') {
    const point = elementPoint(action);
    return point && { key: action.id, point };
  }
}

function framePoint(point: BoardPoint, bounds: BoardBounds, width: number, height: number, view?: BoardView) {
  const boardWidth = bounds.width * width, boardHeight = bounds.height * height;
  const viewport = boardViewport(boardWidth, boardHeight, view), { scale } = viewport;
  const left = bounds.x * width + viewport.left;
  const top = bounds.y * height + viewport.top;
  return { x: Math.max(0, Math.min(1, (left + point.x * scale) / width)),
    y: Math.max(0, Math.min(1, (top + point.y * scale) / height)) };
}

/** Turn persisted board gestures into sparse focus samples on the source timeline. */
export function whiteboardFocusActivity(recording: BoardRecording | undefined, duration: number,
  width: number, height: number): InputActivity[] {
  if (!recording?.events?.length || !Number.isFinite(duration) || !Number.isFinite(width)
    || !Number.isFinite(height) || duration <= 0 || width <= 0 || height <= 0) return [];
  const activity: InputActivity[] = [];
  let visible = false, bounds: BoardBounds = { x: .15, y: .15, width: .7, height: .7 };
  let completeInterface = false;
  let windowBounds: BoardBounds | undefined;
  let view: BoardView | undefined;
  let last: { key: string; t: number; x: number; y: number } | undefined;
  for (const event of recording.events) {
    if (event.t >= duration) break;
    if (event.action.kind === 'viewport') {
      view = event.action.view;
      if (!completeInterface) activity.push({ t: event.t, kind: 'reset' });
      last = undefined; continue;
    }
    if (event.action.kind === 'layout') {
      visible = event.action.visible; bounds = event.action.bounds; windowBounds = event.action.windowBounds;
      completeInterface = event.action.presentation === 'interface';
      activity.push({ t: event.t, kind: 'reset' }); last = undefined;
      continue;
    }
    if (!visible) continue;
    if (event.action.kind === 'focus' && event.action.space === 'window') {
      if (!completeInterface || !windowBounds) continue;
      const focus = { x: Math.min(1, windowBounds.x + event.action.point.x * windowBounds.width),
        y: Math.min(1, windowBounds.y + event.action.point.y * windowBounds.height) };
      const key = `pointer-${Math.round(focus.x * 10)}-${Math.round(focus.y * 10)}`;
      if (last?.key === key && event.t - last.t < 1.1) continue;
      activity.push({ t: event.t, kind: 'typing', focus });
      last = { key, t: event.t, ...focus };
      continue;
    }
    const target = actionPoint(event.action);
    if (!target) continue;
    const focus = framePoint(target.point, bounds, width, height, view);
    const distance = last ? Math.hypot(focus.x - last.x, focus.y - last.y) : Infinity;
    if (last?.key === target.key && (event.t - last.t < .45 || distance < .1 && event.t - last.t < 1.1)) continue;
    activity.push({ t: event.t, kind: 'typing', focus });
    last = { key: target.key, t: event.t, ...focus };
  }
  return activity;
}

/** Whiteboard controls are excluded from video, so native input there must not create screen shots. */
function outsideWhiteboard<T extends { t: number }>(samples: T[], recording: BoardRecording | undefined,
  point: (sample: T) => BoardPoint | undefined): T[] {
  const layout = recording?.events.filter(isLayout) ?? [];
  if (!layout.length) return samples;
  return samples.filter(sample => {
    let low = 0, high = layout.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (layout[middle].t <= sample.t) low = middle + 1;
      else high = middle;
    }
    const action = layout[low - 1]?.action;
    if (!action?.visible || action.passthrough) return true;
    const position = point(sample), area = action.windowBounds;
    if (!position || !area) return false;
    return position.x < area.x || position.x > area.x + area.width
      || position.y < area.y || position.y > area.y + area.height;
  });
}
export const cursorOutsideWhiteboard = (cursor: CursorSample[], recording?: BoardRecording) =>
  outsideWhiteboard(cursor, recording, sample => sample);
export const inputOutsideWhiteboard = (input: InputActivity[] | undefined, recording?: BoardRecording) =>
  input && outsideWhiteboard(input, recording, sample => sample.focus);
