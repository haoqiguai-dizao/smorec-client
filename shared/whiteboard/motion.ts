import type { BoardAction, BoardElement, BoardLine, BoardShape } from './types';

export type BoardRevealStart = number | { t: number; textOnly: true };
export type BoardReveals = Readonly<Record<string, BoardRevealStart>>;
export interface BoardReveal { outline: number; text: number; arrow: number; caret: boolean }
export const BOARD_SHAPE_DRAW_SECONDS = .8;
export const BOARD_LINE_DRAW_SECONDS = .55;
const ARROW_SECONDS = .14;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const textCache = new Map<string, string[]>();

export function boardGraphemes(text: string): string[] {
  let value = textCache.get(text);
  if (!value) {
    value = Array.from(segmenter.segment(text), item => item.segment);
    if (textCache.size >= 128) textCache.delete(textCache.keys().next().value!);
    textCache.set(text, value);
  }
  return value;
}
function unit(value: number): number { return Math.max(0, Math.min(1, value)); }
function ease(value: number): number { const t = unit(value); return t * t * (3 - 2 * t); }

/** A fixed source-time calculation; no wall clock, timers or mutations during export. */
export function boardRevealAt(item: BoardShape | BoardLine, startedAt: BoardRevealStart | undefined, time: number): BoardReveal | undefined {
  if (startedAt === undefined) return;
  const textOnly = typeof startedAt !== 'number' && startedAt.textOnly;
  const elapsed = time - (typeof startedAt === 'number' ? startedAt : startedAt.t);
  if (item.kind === 'line') {
    const end = BOARD_LINE_DRAW_SECONDS + (item.arrow ? ARROW_SECONDS : 0);
    if (elapsed >= end) return;
    return { outline: ease(elapsed / BOARD_LINE_DRAW_SECONDS), text: 1,
      arrow: ease((elapsed - BOARD_LINE_DRAW_SECONDS) / ARROW_SECONDS), caret: false };
  }
  const draw = textOnly || item.shape === 'text' ? 0 : BOARD_SHAPE_DRAW_SECONDS;
  const typing = item.text ? Math.min(2.4, Math.max(.8, boardGraphemes(item.text).length * .14)) : 0;
  if (elapsed >= draw + typing) return;
  return { outline: draw ? ease(elapsed / draw) : 1,
    text: typing ? unit((elapsed - draw) / typing) : 1, arrow: 1,
    caret: elapsed >= draw && Math.floor((elapsed - draw) / .35) % 2 === 0 };
}

export function boardHasReveal(items: BoardElement[], reveals: BoardReveals | undefined, time: number): boolean {
  return !!reveals && items.some(item => (item.kind === 'shape' || item.kind === 'line')
    && !!boardRevealAt(item, reveals[item.id], time));
}

/** Restoring or editing content must never restart its entrance. */
export function remainingBoardReveals(reveals: BoardReveals | undefined, action: BoardAction): BoardReveals | undefined {
  if (!reveals) return;
  if (action.kind === 'undo' || action.kind === 'redo' || action.kind === 'clear' || action.kind === 'reset') return;
  const id = action.kind === 'replace' ? action.element.id : 'id' in action ? action.id : undefined;
  if (!id || reveals[id] === undefined) return reveals;
  const next = { ...reveals }; delete next[id];
  return Object.keys(next).length ? next : undefined;
}

/** Retain only the short active window, rather than a growing per-node animation log. */
export function beginBoardReveal(reveals: BoardReveals | undefined, id: string, time: number, textOnly = false): BoardReveals {
  const active = Object.entries(reveals ?? {}).filter(([, start]) => time - (typeof start === 'number' ? start : start.t) < 3.2);
  return { ...Object.fromEntries(active), [id]: textOnly ? { t: time, textOnly: true } : time };
}
