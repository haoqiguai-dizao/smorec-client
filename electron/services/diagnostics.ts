import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

let pending: Promise<void> = Promise.resolve();
export function diagnostic(scope: string, error?: unknown, detail?: Record<string, unknown>): void {
  const record = { at: new Date().toISOString(), scope,
    ...(error ? { error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack.slice(0, 6000) } : {}) } : {}),
    ...(detail ? { detail } : {}) };
  pending = pending.then(async () => {
    const directory = path.join(app.getPath('userData'), 'diagnostics');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, 'desktop.jsonl');
    const size = await fs.stat(file).then((value) => value.size).catch(() => 0);
    if (size > 5 * 1024 * 1024) {
      await fs.rm(path.join(directory, 'desktop.previous.jsonl'), { force: true });
      await fs.rename(file, path.join(directory, 'desktop.previous.jsonl'));
    }
    await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  }).catch(() => {});
}
export async function flushDiagnostics(): Promise<void> { await pending; }
