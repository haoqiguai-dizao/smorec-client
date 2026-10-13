import { applyBoardEvent, emptyBoard } from '../../../shared/whiteboard/model';
import type { BoardEvent } from '../../../shared/whiteboard/types';

/** A preparation becomes initial content, without replaying preparation time or pointer focus. */
export function draftContent(events: BoardEvent[]): BoardEvent[] {
  const scene = events.reduce(applyBoardEvent, emptyBoard());
  const initial: BoardEvent[] = [];
  for (const item of scene.items) {
    if (item.kind === 'stroke') {
      for (let from = 0; from < item.points.length; from += 256)
        initial.push({ t: 0, action: { ...structuredClone(item), points: item.points.slice(from, from + 256) } });
    } else initial.push({ t: 0, action: structuredClone(item) });
  }
  if (scene.view) initial.push({ t: 0, action: { kind: 'viewport', view: { ...scene.view } } });
  return initial;
}
