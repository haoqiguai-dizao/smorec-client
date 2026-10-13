import type { CursorSample, InputActivity, ZoomSegment } from '../types';
import { buildClickPlans, legacyClickZooms } from './click-zooms';
import { AUTO_ZOOM_EASE_SECONDS, TYPING_HOLD_SECONDS } from './constants';
import { selectionActivities, type SelectionActivity } from './text-selection';

interface ActivityPlan {
  zoom: ZoomSegment;
  firstEvent: number;
  lastEvent: number;
  clickEnd: number;
  lastTyping?: number;
  resetAt?: number;
  focusBased?: boolean;
  selectionId?: string;
}
type FocusActivity = InputActivity | SelectionActivity;
type Event = { t: number; kind: 'click'; click: CursorSample } | FocusActivity;

function validActivity(activity: InputActivity, duration: number): boolean {
  return !!activity && Number.isFinite(activity.t) && activity.t >= 0 && activity.t < duration
    && (activity.kind === 'typing' || activity.kind === 'reset');
}

function validFocus(activity: FocusActivity): activity is FocusActivity & { focus: { x: number; y: number } } {
  const point = activity.focus;
  return (activity.kind === 'typing' || activity.kind === 'selection') && !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function isUsableClick(click: CursorSample): boolean {
  return click.visible && Number.isFinite(click.x) && Number.isFinite(click.y)
    && click.x >= 0 && click.x <= 1 && click.y >= 0 && click.y <= 1;
}

function eventOrder(event: Event): number {
  return event.kind === 'reset' ? 0 : event.kind === 'click' ? 1 : 2;
}

export function buildAutoZooms(cursor: CursorSample[], duration: number, activity?: InputActivity[]): ZoomSegment[] {
  const input: FocusActivity[] = [...(Array.isArray(activity) ? activity.filter((event) => validActivity(event, duration)) : []),
    ...selectionActivities(cursor, duration)];
  if (!input.length) return legacyClickZooms(buildClickPlans(cursor, duration));
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const clicks = cursor.filter((click) => click.click && Number.isFinite(click.t) && click.t >= 0 && click.t < duration)
    .sort((a, b) => a.t - b.t);
  const focusBoundaries = input.filter(validFocus).map(event => event.t).sort((a, b) => a - b);
  // A future click cannot pull an earlier typing shot past the time its focus was observed.
  const clickPlans = buildClickPlans(clicks.filter(isUsableClick), duration, focusBoundaries);
  const plans: ActivityPlan[] = clickPlans.map(({ clicks: group, zoom }) => ({
    zoom: { ...zoom }, firstEvent: group[0].t, lastEvent: group.at(-1)!.t, clickEnd: zoom.end,
  }));
  const byClick = new Map(clickPlans.flatMap((plan, index) => plan.clicks.map((click) => [click, plans[index]] as const)));
  const events: Event[] = [...input, ...clicks.map((click): Event => ({ t: click.t, kind: 'click', click }))]
    .sort((a, b) => a.t - b.t || eventOrder(a) - eventOrder(b));
  let anchor: ActivityPlan | undefined;
  let active: ActivityPlan | undefined;
  let extended = false;

  const reset = (time: number) => {
    if (active) {
      // Copy/control shortcuts invalidate the input anchor but preserve the selection's short reading hold.
      if (!active.selectionId) active.zoom.end = Math.min(active.zoom.end, Math.max(active.clickEnd, time + AUTO_ZOOM_EASE_SECONDS));
      active.resetAt = time;
    }
    anchor = undefined;
    active = undefined;
  };
  for (const event of events) {
    if (event.kind === 'reset') {
      reset(event.t);
    } else if (event.kind === 'click') {
      if (!isUsableClick(event.click)) reset(event.t);
      else {
        anchor = byClick.get(event.click);
        active = anchor;
      }
    } else {
      if (validFocus(event)) {
        const changed = event.kind === 'selection' ? anchor?.selectionId !== event.selectionId
          : !anchor || Math.hypot(anchor.zoom.x - event.focus.x, anchor.zoom.y - event.focus.y) >= 0.16;
        if (changed) {
          reset(event.t);
          active = {
            zoom: { id: `auto-focus-${Math.round(event.t * 1000)}-${plans.length}`,
              start: Math.max(0, event.t - AUTO_ZOOM_EASE_SECONDS), end: event.t,
              x: event.focus.x, y: event.focus.y, scale: 1.7 },
            firstEvent: event.t, lastEvent: event.t, clickEnd: event.t, focusBased: true,
            ...(event.kind === 'selection' ? { selectionId: event.selectionId } : {}),
          };
          plans.push(active);
          anchor = active;
        }
      }
      if (!anchor) continue;
      if (event.kind === 'selection' && active) {
        // One stable shot frames the accumulated drag area, including long and reverse selections.
        active.zoom.x = event.focus.x; active.zoom.y = event.focus.y; active.zoom.scale = event.scale;
      }
      const start = Math.max(0, event.t - AUTO_ZOOM_EASE_SECONDS);
      // A long pause gets a new shot at the known focus, never at the moved pointer.
      if (!active || start > active.zoom.end) {
        active = {
          zoom: { ...anchor.zoom, id: `${anchor.zoom.id}-typing-${Math.round(event.t * 1000)}`, start, end: event.t },
          firstEvent: event.t, lastEvent: event.t, clickEnd: event.t, focusBased: anchor.focusBased,
        };
        plans.push(active);
      }
      active.lastEvent = Math.max(active.lastEvent, event.t);
      active.lastTyping = event.t;
      active.zoom.end = Math.max(active.zoom.end, Math.min(duration, event.t + TYPING_HOLD_SECONDS + AUTO_ZOOM_EASE_SECONDS));
      extended = true;
    }
  }
  // Reset-only journals and unanchored typing must retain the old click plan exactly.
  if (!extended) return legacyClickZooms(clickPlans);
  plans.sort((a, b) => a.firstEvent - b.firstEvent);
  const resolved: ActivityPlan[] = [];
  for (const next of plans) {
    const previous = resolved.at(-1);
    if (!previous) {
      resolved.push(next);
      continue;
    }
    const mergeRadius = previous.focusBased || next.focusBased ? 0.12 : 0.28;
    const sameFocus = Math.hypot(previous.zoom.x - next.zoom.x, previous.zoom.y - next.zoom.y) < mergeRadius;
    const continuousTyping = previous.lastTyping !== undefined && previous.zoom.end >= next.zoom.start
      && (previous.resetAt === undefined || previous.resetAt === next.firstEvent);
    // A new drag owns its own framing; inheriting a preceding narrow shot can crop a wide selection.
    if (sameFocus && continuousTyping && !next.selectionId) {
      previous.zoom.end = Math.max(previous.zoom.end, next.zoom.end);
      previous.lastEvent = next.lastEvent;
      previous.lastTyping = next.lastTyping;
      previous.resetAt = next.resetAt;
      continue;
    }
    if (previous.zoom.end > next.zoom.start) {
      const midpoint = (previous.lastEvent + next.firstEvent) / 2;
      const boundary = Math.max(next.zoom.start, Math.min(previous.zoom.end, midpoint));
      previous.zoom.end = boundary;
      next.zoom.start = boundary;
    }
    resolved.push(next);
  }
  return resolved.map(({ zoom }) => zoom).filter((zoom) => zoom.end - zoom.start > 0.1);
}
