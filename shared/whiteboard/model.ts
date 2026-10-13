import type { BoardAction, BoardBounds, BoardElement, BoardEvent, BoardRecording, BoardPresentation, BoardView } from './types';
import { eraseBoard } from './erase';
import { beginBoardReveal, remainingBoardReveals, type BoardReveals } from './motion';

export interface BoardScene {
  items: BoardElement[];
  undo: BoardElement[][];
  redo: BoardElement[][];
  visible: boolean;
  bounds: BoardBounds;
  windowBounds?: BoardBounds;
  presentation?: BoardPresentation;
  lastGesture?: string;
  view?: BoardView;
  reveals?: BoardReveals;
}
export function emptyBoard(): BoardScene {
  return { items: [], undo: [], redo: [], visible: false, bounds: { x: .15, y: .15, width: .7, height: .7 } };
}
export function applyBoardAction(scene: BoardScene, action: BoardAction): BoardScene {
  const next = applyContentAction(scene, action.kind === 'reveal' ? action.element : action);
  const reveals = remainingBoardReveals(scene.reveals, action);
  return reveals === scene.reveals ? next : { ...next, reveals };
}
function applyContentAction(scene: BoardScene, action: Exclude<BoardAction, { kind: 'reveal' }>): BoardScene {
  if (action.kind === 'reset') return { ...scene, items: [], undo: [], redo: [], view: undefined, reveals: undefined, lastGesture: undefined };
  if (action.kind === 'focus') return scene;
  if (action.kind === 'viewport') return { ...scene, view: action.view };
  if (action.kind === 'undo' || action.kind === 'redo') {
    const from = scene[action.kind];
    if (!from.length) return scene;
    const other = action.kind === 'undo' ? 'redo' : 'undo';
    return { ...scene, items: from.at(-1)!, [action.kind]: from.slice(0, -1),
      [other]: [...scene[other].slice(-99), scene.items], lastGesture: undefined };
  }
  if (action.kind === 'stroke') {
    const last = scene.items.at(-1);
    if (last?.kind === 'stroke' && last.id === action.id) {
      return { ...scene, items: [...scene.items.slice(0, -1), { ...last, points: [...last.points, ...action.points] }] };
    }
  }
  if ((action.kind === 'text' || action.kind === 'shape' || action.kind === 'image' || action.kind === 'line') && scene.items.at(-1)?.id === action.id) {
    return { ...scene, items: [...scene.items.slice(0, -1), action] };
  }
  if (action.kind === 'replace') {
    const index = scene.items.findIndex(item => item.id === action.element.id && item.kind === action.element.kind);
    if (index < 0) return scene;
    const items = [...scene.items]; items[index] = action.element;
    return { ...scene, items, undo: scene.lastGesture === action.gesture ? scene.undo : [...scene.undo.slice(-99), scene.items],
      redo: [], lastGesture: action.gesture };
  }
  if (action.kind === 'connect-node') {
    if (scene.items.some(item => item.id === action.node.id)) return scene;
    const existing = scene.items.at(-1);
    const updating = existing?.kind === 'line' && existing.id === action.line.id;
    const previous = updating ? scene.items.slice(0, -1) : scene.items;
    return { ...scene, items: [...previous, action.line, action.node],
      undo: updating ? scene.undo : [...scene.undo.slice(-99), scene.items], redo: [], lastGesture: undefined };
  }
  if (action.kind === 'erase') {
    const items = eraseBoard(scene.items, action.points, action.radius, action.id);
    if (items.length === scene.items.length && items.every((item, i) => item === scene.items[i])) return scene;
    return { ...scene, items, undo: scene.lastGesture === action.gesture ? scene.undo : [...scene.undo.slice(-99), scene.items],
      redo: [], lastGesture: action.gesture };
  }
  if (action.kind === 'delete') {
    const items = scene.items.filter(item => item.id !== action.id
      && !(item.kind === 'line' && (item.start.shapeId === action.id || item.end.shapeId === action.id)));
    if (items.length === scene.items.length) return scene;
    return { ...scene, items, undo: [...scene.undo.slice(-99), scene.items], redo: [], lastGesture: undefined };
  }
  if (action.kind === 'clear' && !scene.items.length) return scene;
  return { ...scene, items: action.kind === 'clear' ? [] : [...scene.items, action as BoardElement],
    undo: [...scene.undo.slice(-99), scene.items], redo: [], lastGesture: undefined };
}
export function applyBoardEvent(scene: BoardScene, event: BoardEvent): BoardScene {
  if (event.action.kind === 'layout') return { ...scene, visible: event.action.visible, bounds: event.action.bounds,
    windowBounds: event.action.windowBounds, presentation: event.action.presentation ?? 'canvas' };
  const next = applyBoardAction(scene, event.action);
  if (next === scene) return next;
  const action = event.action;
  if (action.kind === 'reveal') return { ...next, reveals: beginBoardReveal(next.reveals, action.element.id, event.t) };
  if (action.kind === 'connect-node' && action.reveal)
    return { ...next, reveals: beginBoardReveal(next.reveals, action.node.id, event.t) };
  if (action.kind === 'replace' && action.reveal === 'text')
    return { ...next, reveals: beginBoardReveal(next.reveals, action.element.id, event.t, true) };
  return next;
}
const cache = new WeakMap<BoardRecording, { index: number; time: number; scene: BoardScene }>();
/** Source-time replay is shared by preview and export; seeking backwards resets the cursor. */
export function boardAt(recording: BoardRecording, time: number): BoardScene {
  let current = cache.get(recording);
  if (!current || time < current.time) current = { index: 0, time: -1, scene: emptyBoard() };
  while (current.index < recording.events.length && recording.events[current.index].t <= time) {
    current.scene = applyBoardEvent(current.scene, recording.events[current.index++]);
  }
  current.time = time;
  cache.set(recording, current);
  return current.scene;
}
