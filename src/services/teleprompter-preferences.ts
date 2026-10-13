export interface TeleprompterPreferences { text: string; speed: number; fontSize: number }
export const TELEPROMPTER_TEXT_LIMIT = 20_000;
export const TELEPROMPTER_PREFERENCES_KEY = 'frameflow.teleprompter.v1';
const DEFAULTS: TeleprompterPreferences = { text: '', speed: 30, fontSize: 26 };
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): PreferenceStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; }
  catch { return undefined; }
}
export function normalizeTeleprompterPreferences(value: unknown): TeleprompterPreferences {
  const fields = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const bounded = (key: 'speed' | 'fontSize', min: number, max: number) => typeof fields[key] === 'number' && Number.isFinite(fields[key])
    ? Math.max(min, Math.min(max, fields[key])) : DEFAULTS[key];
  return { text: typeof fields.text === 'string' ? fields.text.slice(0, TELEPROMPTER_TEXT_LIMIT) : '',
    speed: bounded('speed', 10, 100), fontSize: bounded('fontSize', 18, 48) };
}
export function readTeleprompterPreferences(source = storage()): TeleprompterPreferences {
  try { return normalizeTeleprompterPreferences(JSON.parse(source?.getItem(TELEPROMPTER_PREFERENCES_KEY) ?? 'null')); }
  catch { return { ...DEFAULTS }; }
}
export function saveTeleprompterPreferences(value: TeleprompterPreferences, destination = storage()): void {
  try { destination?.setItem(TELEPROMPTER_PREFERENCES_KEY, JSON.stringify(normalizeTeleprompterPreferences(value))); }
  catch { /* Keep the current script usable when storage is unavailable or full. */ }
}
