import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { TELEMETRY_EVENTS, type TelemetryChannel, type TelemetryEventName, type TelemetryPlatform,
  type TelemetryPreferences, type TelemetryProperties, type TelemetrySnapshot, type InstallationReceipt } from '../../../shared/telemetry-types';
import { emptyState, TelemetryStore, type TelemetryState } from './store';
import { sendBatch, type TelemetryFetch } from './transport';
import { MAX_BATCH_EVENTS, MAX_QUEUE_EVENTS, parseEvent, parseProperties, retryDelay, validEndpoint, validVersion, UUID } from './validation';

export interface TelemetryOptions {
  directory: string; endpoint: string; version: string; channel: TelemetryChannel; platform: TelemetryPlatform; packaged: boolean;
  fetch?: TelemetryFetch;
}

/** No device fingerprinting: only an opt-in random installation UUID and validated event metadata. */
export function createTelemetry(options: TelemetryOptions) {
  if (!path.isAbsolute(options.directory) || !validEndpoint(options.endpoint) || !validVersion(options.version)
    || !['stable', 'beta'].includes(options.channel) || !['win32', 'darwin', 'linux'].includes(options.platform)) {
    throw new Error('Telemetry configuration is invalid');
  }
  const store = new TelemetryStore(options.directory);
  let state: TelemetryState = emptyState(), initialization: Promise<void> | undefined;
  let running = false, sessionStarted = 0, generation = 0, retryAttempt = 0, droppedEvents = 0;
  let lastSentAt: string | undefined, lastError: TelemetrySnapshot['lastError'];
  let pendingWrite: Promise<boolean> = Promise.resolve(true), inFlight: Promise<void> | undefined;
  let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const allowed = () => options.packaged && state.consent === 'enabled';
  const preferences = (): TelemetryPreferences => ({ consent: state.consent, enabled: allowed() });
  const snapshot = (): TelemetrySnapshot => ({ ...preferences(), running, sending: !!inFlight, queuedEvents: state.queue.length,
    droppedEvents, retryAttempt, ...(lastSentAt ? { lastSentAt } : {}), ...(lastError ? { lastError } : {}) });
  const initialize = () => initialization ??= store.read().then(value => { state = value; })
    .catch(() => { state = emptyState(); lastError = 'storage_unavailable'; });
  function persist(): Promise<boolean> {
    pendingWrite = store.write(state).then(() => { if (lastError === 'storage_unavailable') lastError = undefined; return true; })
      .catch(() => { lastError = 'storage_unavailable'; return false; });
    return pendingWrite;
  }
  function schedule(delay: number): void {
    if (timer || !running || !allowed() || !state.queue.length) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
    timer.unref?.();
  }
  function enqueue(name: TelemetryEventName, properties: TelemetryProperties = {}, receipt?: InstallationReceipt): boolean {
    if (!allowed() || !running || !TELEMETRY_EVENTS.includes(name)) return false;
    const safe = parseProperties(name, properties); if (!safe) return false;
    state.queue.push({ event_id: receipt?.event_id ?? randomUUID(), name, occurred_at: new Date().toISOString(), app_version: receipt?.version ?? options.version,
      channel: options.channel, platform: options.platform, properties: safe });
    if (state.queue.length > MAX_QUEUE_EVENTS) {
      const index = state.queue.findIndex(event => event.name !== 'app_first_open');
      state.queue.splice(Math.max(0, index), 1); droppedEvents++;
    }
    void persist(); schedule(state.queue.length >= MAX_BATCH_EVENTS ? 0 : 1000); return true;
  }
  function openSession(): void {
    if (!allowed()) return;
    state.installation_id ??= randomUUID(); sessionStarted = Date.now();
    if (!state.first_open_recorded) { state.first_open_recorded = true; enqueue('app_first_open'); }
    enqueue('app_open');
  }
  async function send(): Promise<void> {
    const currentGeneration = generation;
    if (!allowed() || !state.installation_id || !await pendingWrite || generation !== currentGeneration) return;
    state.queue = state.queue.filter(event => !!parseEvent(event, Date.now()));
    const events = state.queue.slice(0, MAX_BATCH_EVENTS); if (!events.length) return;
    const request = controller = new AbortController();
    const result = await sendBatch(options.fetch ?? globalThis.fetch, options.endpoint,
      { schema_version: 1, installation_id: state.installation_id, events }, request);
    if (controller === request) controller = undefined;
    if (generation !== currentGeneration || !allowed()) return;
    if (result === 'accepted' || result === 'rejected') {
      const ids = new Set(events.map(event => event.event_id));
      state.queue = state.queue.filter(event => !ids.has(event.event_id)); retryAttempt = 0;
      if (result === 'accepted') { lastSentAt = new Date().toISOString(); lastError = undefined; }
      else { droppedEvents += events.length; lastError = 'rejected'; }
      await persist(); schedule(1000);
    } else if (result !== 'cancelled') {
      lastError = result === 'timeout' ? 'timeout' : 'network_error'; retryAttempt++;
      schedule(retryDelay(retryAttempt));
    }
  }
  function flush(): Promise<void> {
    if (inFlight) return inFlight;
    const task = send().finally(() => { if (inFlight === task) inFlight = undefined; });
    inFlight = task; return task;
  }
  async function start(): Promise<void> {
    await initialize(); if (running) return;
    running = true;
    if (allowed()) { openSession(); await pendingWrite; schedule(0); }
  }
  async function setEnabled(enabled: boolean): Promise<TelemetryPreferences> {
    if (typeof enabled !== 'boolean') throw new Error('Telemetry consent must be explicit');
    await initialize();
    const next = enabled ? 'enabled' : 'disabled';
    if (state.consent === next) {
      if (lastError === 'storage_unavailable' && !await persist()) throw new Error('无法保存统计设置，请检查应用数据目录权限后重试');
      if (enabled) schedule(0); return preferences();
    }
    generation++; clearTimeout(timer); timer = undefined; controller?.abort(); controller = undefined;
    state.consent = next; retryAttempt = 0; state.queue = [];
    if (enabled && options.packaged) { state.installation_id ??= randomUUID(); if (running) openSession(); }
    if (!await persist()) throw new Error('无法保存统计设置，请检查应用数据目录权限后重试');
    if (enabled) schedule(0); return preferences();
  }
  async function stop(): Promise<void> {
    await initialize(); if (!running) { await pendingWrite; return; }
    if (allowed()) enqueue('app_close', { duration_ms: Math.min(604800000, Math.max(0, Date.now() - sessionStarted)) });
    running = false; clearTimeout(timer); timer = undefined;
    await pendingWrite; await flush();
    // Persist the final snapshot, including a transport ACK whose earlier disk write failed.
    // A restart can safely retry an old ID, but a clean stop should not leave a stale queue behind.
    if (allowed()) await persist(); else await pendingWrite;
  }
  function trackInstallationReceipt(receipt: InstallationReceipt): boolean {
    if (!allowed() || !running || !receipt || typeof receipt !== 'object' || receipt.schema !== 1
      || Object.keys(receipt).some(key => !['schema', 'version', 'event_id'].includes(key))
      || !validVersion(receipt.version) || typeof receipt.event_id !== 'string' || !UUID.test(receipt.event_id)) return false;
    const id = receipt.event_id.toLowerCase(), recorded = state.recorded_installation_receipts ?? [];
    if (recorded.includes(id)) return false;
    state.recorded_installation_receipts = [...recorded, id].slice(-20);
    return enqueue('install_success', {}, { schema: 1, version: receipt.version, event_id: id });
  }
  const track = (name: TelemetryEventName, properties?: TelemetryProperties) => name !== 'install_success' && enqueue(name, properties);
  return { preferences, snapshot, setEnabled, track, trackInstallationReceipt, start, stop };
}
export type Telemetry = ReturnType<typeof createTelemetry>;
