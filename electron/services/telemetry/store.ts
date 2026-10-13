import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TelemetryConsent, TelemetryEvent } from '../../../shared/telemetry-types';
import { MAX_QUEUE_EVENTS, MAX_STATE_BYTES, parseEvent, UUID } from './validation';
import { replaceTelemetryState } from './atomic-replace';

export interface TelemetryState {
  schema_version: 1; consent: TelemetryConsent; installation_id?: string; first_open_recorded: boolean; queue: TelemetryEvent[];
  recorded_installation_receipts?: string[];
}
export function emptyState(): TelemetryState { return { schema_version: 1, consent: 'unselected', first_open_recorded: false, queue: [] }; }
export class TelemetryStore {
  private pending: Promise<void> = Promise.resolve();
  private file: string;
  constructor(private directory: string) { this.file = path.join(directory, 'telemetry-state.json'); }
  async read(): Promise<TelemetryState> {
    let content: string;
    try {
      const info = await fs.stat(this.file);
      if (info.size > MAX_STATE_BYTES || !info.isFile()) return emptyState();
      content = await fs.readFile(this.file, 'utf8');
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState(); throw error; }
    try {
      const value = JSON.parse(content) as Partial<TelemetryState>;
      if (!value || value.schema_version !== 1 || !['unselected', 'enabled', 'disabled'].includes(value.consent ?? '')
        || typeof value.first_open_recorded !== 'boolean' || !Array.isArray(value.queue)
        || value.queue.length > MAX_QUEUE_EVENTS || value.installation_id !== undefined && !UUID.test(value.installation_id)
        || !value.installation_id && (value.first_open_recorded || value.queue.length > 0)
        || value.recorded_installation_receipts !== undefined && (!Array.isArray(value.recorded_installation_receipts)
          || value.recorded_installation_receipts.length > 20 || value.recorded_installation_receipts.some(id => typeof id !== 'string' || !UUID.test(id)))) return emptyState();
      const queue = value.queue.map(event => parseEvent(event, Date.now())).filter((event): event is TelemetryEvent => !!event);
      // A never-consented or opted-out installation cannot restore queued events from disk.
      return { schema_version: 1, consent: value.consent!, first_open_recorded: value.first_open_recorded,
        ...(value.consent !== 'unselected' && value.installation_id ? { installation_id: value.installation_id } : {}),
        recorded_installation_receipts: value.consent === 'unselected' ? [] : [...new Set(value.recorded_installation_receipts?.map(id => id.toLowerCase()) ?? [])],
        queue: value.consent === 'enabled' ? queue : [] };
    } catch { return emptyState(); }
  }
  write(state: TelemetryState): Promise<void> {
    const content = JSON.stringify(state);
    const task = async () => {
      if (Buffer.byteLength(content, 'utf8') > MAX_STATE_BYTES) throw new Error('Telemetry state exceeds its storage bound');
      await fs.mkdir(this.directory, { recursive: true });
      const temporary = this.file + '.tmp';
      await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
      await replaceTelemetryState(temporary, this.file);
    };
    this.pending = this.pending.catch(() => {}).then(task);
    return this.pending;
  }
}
