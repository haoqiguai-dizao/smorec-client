import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { doSpawn } = require('builder-util');

export function stopOwnedCompiler(child, spawnCleanup = spawn) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    return Promise.reject(new Error('Cannot stop compiler without its owned process ID'));
  }
  return new Promise((resolve, reject) => {
    const cleanup = spawnCleanup(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    const timer = setTimeout(() => {
      cleanup.kill();
      reject(new Error('Timed out stopping the compiler process tree'));
    }, 5_000);
    cleanup.once('error', error => { clearTimeout(timer); reject(error); });
    cleanup.once('close', code => {
      clearTimeout(timer);
      if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
      else reject(new Error(`Could not stop compiler process tree (${code})`));
    });
  });
}

export function createInstallerProcessRunner({ cwd, spawnCompiler = doSpawn, spawnExecutable = spawn,
  stopCompiler = stopOwnedCompiler } = {}) {
  function run(command, args, environment, timeout, spawnProcess, stopProcess) {
    return new Promise((resolve, reject) => {
      const child = spawnProcess(command, args, {
        cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...environment },
      });
      let stdout = '', stderr = '', timedOut = false, settled = false;
      let timer;
      const finish = (error, code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve({ code, stdout, stderr });
      };
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      timer = setTimeout(() => {
        timedOut = true;
        // A compiler .cmd entrypoint owns a child EXE; stop that tree, not only its shell.
        Promise.resolve().then(() => stopProcess(child)).then(
          () => finish(new Error(`Timed out: ${command}`)),
          error => finish(new Error(`Timed out: ${command}; cleanup failed: ${error.message}`, { cause: error })),
        );
      }, timeout);
      child.once('error', error => { if (!timedOut) finish(error); });
      child.once('close', code => { if (!timedOut) finish(null, code); });
    });
  }
  return {
    runCompiler: (command, args, environment = {}, timeout = 60_000) =>
      run(command, args, environment, timeout, spawnCompiler, stopCompiler),
    runExecutable: (command, args, environment = {}, timeout = 60_000) =>
      run(command, args, environment, timeout, spawnExecutable, child => child.kill()),
  };
}
