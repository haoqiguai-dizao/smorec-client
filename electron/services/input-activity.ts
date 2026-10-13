import type { InputActivity } from '../../shared/types';

export const MAX_INPUT_ACTIVITY_EVENTS = 1_728_001;

/** Only source-clock activity is retained, never key codes or text. */
export function parseInputActivity(value: unknown, duration: number): InputActivity[] {
  if (!Number.isFinite(duration) || duration < 0 || !Array.isArray(value)
    || value.length > MAX_INPUT_ACTIVITY_EVENTS) throw new Error('输入活动记录无效或过大');
  let previous = 0;
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Reflect.ownKeys(item).some(key => key !== 't' && key !== 'kind' && key !== 'focus')) {
      throw new Error('输入活动记录包含不支持的字段');
    }
    const event = item as Record<string, unknown>;
    if (typeof event.t !== 'number' || !Number.isFinite(event.t) || event.t < previous || event.t > duration
      || (event.kind !== 'typing' && event.kind !== 'reset')) throw new Error('输入活动时间或类型无效');
    previous = event.t;
    if (event.focus !== undefined) {
      const focus = event.focus as Record<string, unknown>;
      if (event.kind !== 'typing' || !focus || typeof focus !== 'object' || Array.isArray(focus)
        || Reflect.ownKeys(focus).some(key => key !== 'x' && key !== 'y')
        || ![focus.x, focus.y].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) {
        throw new Error('输入焦点坐标无效');
      }
      return { t: event.t, kind: event.kind, focus: { x: focus.x as number, y: focus.y as number } };
    }
    return { t: event.t, kind: event.kind };
  });
}
