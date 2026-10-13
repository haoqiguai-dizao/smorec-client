import type { CursorSample, ZoomSegment } from '../types';
import { AUTO_ZOOM_EASE_SECONDS } from './constants';

export interface ClickPlan {
  clicks: CursorSample[];
  zoom: ZoomSegment;
}

export function buildClickPlans(cursor: CursorSample[], duration: number, focusBoundaries: number[] = []): ClickPlan[] {
  const clicks = cursor.filter((sample) => sample.click && sample.visible && sample.t >= 0 && sample.t < duration);
  const groups: CursorSample[][] = [];
  let boundaryIndex = 0;
  for (const click of clicks) {
    const previous = groups.at(-1);
    const last = previous?.at(-1);
    let crossedFocus = false;
    while (boundaryIndex < focusBoundaries.length && focusBoundaries[boundaryIndex] <= click.t) {
      if (last && focusBoundaries[boundaryIndex] > last.t) crossedFocus = true;
      boundaryIndex++;
    }
    if (last && !crossedFocus && click.t - last.t < 2.2 && Math.hypot(click.x - last.x, click.y - last.y) < 0.28) previous!.push(click);
    else groups.push([click]);
  }
  return groups.map((group, index) => ({
    clicks: group,
    zoom: {
      id: `auto-${index}-${Math.round(group[0].t * 1000)}`,
      start: Math.max(0, group[0].t - AUTO_ZOOM_EASE_SECONDS),
      end: Math.min(duration, group.at(-1)!.t + 1.65),
      x: group.reduce((sum, sample) => sum + sample.x, 0) / group.length,
      y: group.reduce((sum, sample) => sum + sample.y, 0) / group.length,
      scale: 1.7,
    },
  }));
}

export function legacyClickZooms(plans: ClickPlan[]): ZoomSegment[] {
  const zooms = plans.map(({ zoom }) => ({ ...zoom }));
  for (let index = 1; index < zooms.length; index++) {
    const previous = zooms[index - 1];
    const next = zooms[index];
    if (previous.end > next.start) {
      const boundary = (plans[index - 1].clicks.at(-1)!.t + plans[index].clicks[0].t) / 2;
      previous.end = boundary;
      next.start = boundary;
    }
  }
  return zooms.filter((zoom) => zoom.end - zoom.start > 0.1);
}
