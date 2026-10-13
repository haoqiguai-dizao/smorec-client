import type { LiveApplication } from '../../shared/live-types';
import { applicationIdentity, isMacApplicationID } from '../../shared/application-identity';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const LIVE_APPLICATION_SELECTION_KEY = 'frameflow.live.excludedApplications.v1';
const defaultExecutables = new Set(['直播伴侣.exe', 'xhs-live-helper.exe']);
const identity = applicationIdentity;
const basename = (value: string): string => value.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? '';
const cleanString = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0
  && value.length <= maximum && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** Only application identity and display metadata are retained, never a PID or window title. */
export function parseLiveApplications(value: unknown): LiveApplication[] {
  if (!Array.isArray(value) || value.length > 1024) throw new Error('排除应用列表无效，请刷新重试');
  const seen = new Set<string>();
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || !cleanString(item.id, 1024) || !cleanString(item.name, 256)
      || !cleanString(item.executable, 1024)
      || !(isMacApplicationID(item.id) ? item.executable === item.id
        : /^[a-z]:[\\/]/i.test(item.id) && basename(item.id).endsWith('.exe') && basename(item.executable) === basename(item.id)))
      throw new Error('排除应用列表无效，请刷新重试');
    const key = identity(item.id);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: item.id, name: item.name, executable: item.executable }];
  });
}

/** undefined means no explicit choice; [] is an explicit request to exclude nothing. */
export function readLiveApplicationSelection(storage: PreferenceStorage = globalThis.localStorage): LiveApplication[] | undefined {
  const value = storage.getItem(LIVE_APPLICATION_SELECTION_KEY);
  if (value === null) return undefined;
  const selection = parseLiveApplications(JSON.parse(value));
  if (selection.length > 32) throw new Error('最多排除 32 个应用');
  return selection;
}
export function saveLiveApplicationSelection(selection: LiveApplication[], storage: PreferenceStorage = globalThis.localStorage): void {
  const valid = parseLiveApplications(selection);
  if (valid.length > 32) throw new Error('最多排除 32 个应用');
  storage.setItem(LIVE_APPLICATION_SELECTION_KEY, JSON.stringify(valid));
}
export function defaultLiveApplicationSelection(applications: LiveApplication[]): LiveApplication[] {
  return applications.filter(application => defaultExecutables.has(basename(application.executable))).map(application => ({ ...application }));
}
export function applicationSelected(selection: LiveApplication[], id: string): boolean {
  return selection.some(application => identity(application.id) === identity(id));
}
export function updateLiveApplicationSelection(selection: LiveApplication[], application: LiveApplication, selected: boolean): LiveApplication[] {
  const remaining = selection.filter(item => identity(item.id) !== identity(application.id));
  const next = parseLiveApplications(selected ? [...remaining, application] : remaining);
  if (next.length > 32) throw new Error('最多排除 32 个应用');
  return next;
}
export function liveApplicationChoices(current: LiveApplication[], selected: LiveApplication[]): (LiveApplication & { running: boolean })[] {
  // Preserve explicitly selected applications after they exit, so each remains removable.
  const missing = selected.filter(application => !current.some(item => identity(item.id) === identity(application.id)));
  return [...current.map(application => ({ ...application, running: true })), ...missing.map(application => ({ ...application, running: false }))];
}
