import { promises as fs } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 800] as const;
const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

interface ReplaceOperations {
  rename(source: string, destination: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
}

/** Windows readers/scanners can briefly deny replacement even after writeFile has closed. */
export async function replaceTelemetryState(source: string, destination: string, operations: ReplaceOperations = {
  rename: (from, to) => fs.rename(from, to), wait: milliseconds => delay(milliseconds),
}): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await operations.rename(source, destination); return; }
    catch (error) {
      if (!RETRYABLE_CODES.has((error as NodeJS.ErrnoException)?.code ?? '') || attempt >= RETRY_DELAYS_MS.length) throw error;
      // Keep the previous destination intact. Never unlink it as a rename fallback.
      await operations.wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}
