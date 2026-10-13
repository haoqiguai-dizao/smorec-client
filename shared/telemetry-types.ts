export const TELEMETRY_EVENTS = ['install_success', 'app_first_open', 'app_open', 'app_close', 'recording_start', 'recording_end',
  'live_start', 'live_end', 'export_end', 'update_result'] as const;
export const TELEMETRY_ERROR_CODES = ['none', 'unknown', 'permission_denied', 'device_unavailable', 'capture_failed',
  'encoder_failed', 'export_failed', 'network_error', 'timeout', 'cancelled', 'update_failed', 'storage_unavailable'] as const;
export type TelemetryEventName = typeof TELEMETRY_EVENTS[number];
export type TelemetryErrorCode = typeof TELEMETRY_ERROR_CODES[number];
export type TelemetryConsent = 'unselected' | 'enabled' | 'disabled';
export type TelemetryChannel = 'stable' | 'beta';
export type TelemetryPlatform = 'win32' | 'darwin' | 'linux';
export interface InstallationReceipt { schema: 1; version: string; event_id: string }
export interface TelemetryProperties {
  duration_ms?: number;
  outcome?: 'success' | 'failure' | 'cancelled';
  error_code?: TelemetryErrorCode;
  target_version?: string;
}
export interface TelemetryEvent {
  event_id: string;
  name: TelemetryEventName;
  occurred_at: string;
  app_version: string;
  channel: TelemetryChannel;
  platform: TelemetryPlatform;
  properties: TelemetryProperties;
}
export interface TelemetryBatch { schema_version: 1; installation_id: string; events: TelemetryEvent[] }
export interface TelemetryPreferences { consent: TelemetryConsent; enabled: boolean }
export interface TelemetrySnapshot extends TelemetryPreferences {
  running: boolean; sending: boolean; queuedEvents: number; droppedEvents: number; retryAttempt: number;
  lastSentAt?: string; lastError?: 'storage_unavailable' | 'network_error' | 'timeout' | 'rejected';
}
