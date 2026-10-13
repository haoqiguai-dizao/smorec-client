import type { TelemetryBatch } from '../../../shared/telemetry-types';
import { REQUEST_TIMEOUT_MS } from './validation';

export type TelemetryFetch = (input: string, init: RequestInit) => Promise<Pick<Response, 'status'>>;
export type SendResult = 'accepted' | 'retry' | 'rejected' | 'timeout' | 'cancelled';
export async function sendBatch(fetch: TelemetryFetch, endpoint: string, batch: TelemetryBatch, controller: AbortController): Promise<SendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  let timedOut = false;
  const cancelled = new Promise<SendResult>(resolve => {
    abortListener = () => resolve(timedOut ? 'timeout' : 'cancelled');
    controller.signal.addEventListener('abort', abortListener, { once: true });
    if (controller.signal.aborted) abortListener();
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
  });
  const request = Promise.resolve().then(() => {
    if (controller.signal.aborted) return 'cancelled' as const;
    return fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch), signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
      .then(response => response.status >= 200 && response.status < 300 ? 'accepted' as const
        : response.status === 408 || response.status === 429 || response.status >= 500 ? 'retry' as const : 'rejected' as const);
  }).catch(() => controller.signal.aborted ? timedOut ? 'timeout' as const : 'cancelled' as const : 'retry' as const);
  try { return await Promise.race([request, cancelled]); }
  finally { clearTimeout(timer); if (abortListener) controller.signal.removeEventListener('abort', abortListener); }
}
