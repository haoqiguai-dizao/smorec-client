import { TELEMETRY_ERROR_CODES, TELEMETRY_EVENTS, type TelemetryEvent, type TelemetryEventName,
  type TelemetryProperties } from '../../../shared/telemetry-types';

export const MAX_QUEUE_EVENTS = 500;
export const MAX_BATCH_EVENTS = 50;
export const MAX_STATE_BYTES = 512 * 1024;
export const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 3000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const ending = new Set<TelemetryEventName>(['recording_end', 'live_end', 'export_end', 'update_result']);
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function validVersion(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || !versionPattern.test(value)) return false;
  const prerelease = value.match(/^[^-+]+-([^+]+)/)?.[1];
  return !prerelease?.split('.').some(identifier => /^0\d+$/.test(identifier));
}
export function validEndpoint(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}
export function parseProperties(name: TelemetryEventName, value: unknown): TelemetryProperties | undefined {
  if (!object(value)) return;
  const allowed = new Set<string>(name === 'app_close' ? ['duration_ms'] : ending.has(name)
    ? ['duration_ms', 'outcome', 'error_code', ...(name === 'update_result' ? ['target_version'] : [])] : []);
  if (Object.keys(value).some(key => !allowed.has(key))) return;
  const { duration_ms, outcome, error_code, target_version } = value;
  if ('duration_ms' in value && (typeof duration_ms !== 'number' || !Number.isInteger(duration_ms) || duration_ms < 0 || duration_ms > 604800000)) return;
  if ('outcome' in value && (typeof outcome !== 'string' || !['success', 'failure', 'cancelled'].includes(outcome))) return;
  if ('error_code' in value && (typeof error_code !== 'string' || !TELEMETRY_ERROR_CODES.includes(error_code as never))) return;
  if ('target_version' in value && !validVersion(target_version)) return;
  return { ...(duration_ms !== undefined ? { duration_ms: duration_ms as number } : {}),
    ...(outcome !== undefined ? { outcome: outcome as TelemetryProperties['outcome'] } : {}),
    ...(error_code !== undefined ? { error_code: error_code as TelemetryProperties['error_code'] } : {}),
    ...(target_version !== undefined ? { target_version: target_version as string } : {}) };
}
export function parseEvent(value: unknown, now: number): TelemetryEvent | undefined {
  if (!object(value) || Object.keys(value).some(key => !['event_id', 'name', 'occurred_at', 'app_version', 'channel', 'platform', 'properties'].includes(key))
    || typeof value.event_id !== 'string' || !UUID.test(value.event_id) || !TELEMETRY_EVENTS.includes(value.name as never)
    || !validVersion(value.app_version) || typeof value.channel !== 'string' || !['stable', 'beta'].includes(value.channel)
    || typeof value.platform !== 'string' || !['win32', 'darwin', 'linux'].includes(value.platform)
    || typeof value.occurred_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.occurred_at)) return;
  const time = Date.parse(value.occurred_at);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value.occurred_at || time < now - EVENT_TTL_MS || time > now + 300000) return;
  const properties = parseProperties(value.name as TelemetryEventName, value.properties);
  if (!properties) return;
  return { event_id: value.event_id, name: value.name as TelemetryEventName, occurred_at: value.occurred_at,
    app_version: value.app_version, channel: value.channel as TelemetryEvent['channel'], platform: value.platform as TelemetryEvent['platform'], properties };
}
export function retryDelay(attempt: number): number { return Math.min(300000, 1000 * 2 ** Math.min(9, Math.max(0, attempt - 1))); }
