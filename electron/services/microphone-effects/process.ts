import { spawn } from 'node:child_process';

export function runMicrophoneProcess(executable: string, args: string[], signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const process = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '', failure: Error | undefined;
    const abort = () => { process.kill(); };
    const timer = setTimeout(() => { failure = new Error('麦克风效果处理超时，请重试或恢复原声'); process.kill(); }, 30 * 60_000);
    signal.addEventListener('abort', abort, { once: true });
    // Catch cancellation between the initial check and listener registration.
    if (signal.aborted) abort();
    process.stderr.on('data', (bytes: Buffer) => { stderr = (stderr + bytes.toString()).slice(-4000); });
    process.once('error', error => { failure = error; });
    process.once('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (signal.aborted) { reject(new DOMException('麦克风效果处理已取消', 'AbortError')); return; }
      if (failure || code !== 0) { reject(new Error(`麦克风效果处理失败：${failure?.message || stderr.trim() || `退出码 ${code}`}`)); return; }
      resolve();
    });
  });
}
