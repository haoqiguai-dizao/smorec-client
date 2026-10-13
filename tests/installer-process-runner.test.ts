import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createInstallerProcessRunner, stopOwnedCompiler } = require('../scripts/installer-verification/process-runner.mjs');

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 12345;
  exitCode: number | null = null;
  signalCode: string | null = null;
  kills = 0;
  kill() { this.kills += 1; return true; }
  close(code = 0) { this.exitCode = code; this.emit('close', code); }
}

function fixture() {
  const compiler = new FakeChild();
  const executable = new FakeChild();
  const calls: Array<{ kind: string; command: string; args: string[]; options: Record<string, unknown> }> = [];
  const stops: FakeChild[] = [];
  const makeSpawn = (kind: string, child: FakeChild) =>
    (command: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ kind, command, args, options });
      return child;
    };
  const runner = createInstallerProcessRunner({ cwd: 'D:\\Recorder Project',
    spawnCompiler: makeSpawn('compiler', compiler), spawnExecutable: makeSpawn('executable', executable),
    stopCompiler: async (child: FakeChild) => { stops.push(child); child.close(1); },
  });
  return { ...runner, compiler, executable, calls, stops };
}

test('compiler alone uses the builder runner and preserves .cmd paths and argument arrays', async () => {
  const f = fixture();
  const command = 'C:\\Build Cache\\nsis@1.2.1\\makensis.cmd';
  const args = ['/V3', '/INPUTCHARSET', 'UTF8', 'D:\\Recorder Project\\qa & input.nsi'];
  const promise = f.runCompiler(command, args, { NSISDIR: 'C:\\Build Cache\\windows' });
  f.compiler.stdout.write('compiler output');
  f.compiler.stderr.write('compiler warning');
  f.compiler.close();
  assert.deepEqual(await promise, { code: 0, stdout: 'compiler output', stderr: 'compiler warning' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].kind, 'compiler');
  assert.equal(f.calls[0].command, command);
  assert.equal(f.calls[0].args, args);
  assert.equal(f.calls[0].options.shell, false);
  assert.equal(f.calls[0].options.windowsHide, true);
  assert.deepEqual(f.calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal((f.calls[0].options.env as Record<string, unknown>).NSISDIR, 'C:\\Build Cache\\windows');
  assert.equal(f.calls[0].options.cwd, 'D:\\Recorder Project');
  assert.equal(f.stops.length, 0);
});

test('QA executable uses only the original Node process runner', async () => {
  const f = fixture();
  const command = 'D:\\Recorder Project\\installer-directory-qa.exe';
  const promise = f.runExecutable(command, ['/S']);
  f.executable.close(9);
  assert.deepEqual(await promise, { code: 9, stdout: '', stderr: '' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].kind, 'executable');
  assert.equal(f.calls[0].command, command);
  assert.deepEqual(f.calls[0].args, ['/S']);
  assert.equal(f.calls[0].options.shell, false);
  assert.equal(f.stops.length, 0);
});

test('production defaults keep builder doSpawn separate from Node spawn', () => {
  const source = readFileSync('scripts/installer-verification/process-runner.mjs', 'utf8');
  assert.match(source, /import \{ spawn \} from 'node:child_process'/);
  assert.match(source, /const \{ doSpawn \} = require\('builder-util'\)/);
  assert.match(source, /spawnCompiler = doSpawn, spawnExecutable = spawn/);
  const integration = readFileSync('scripts/verify-installer-directory.mjs', 'utf8');
  assert.match(integration, /runCompiler\(compiler\.path,/);
  assert.match(integration, /runExecutable\(executable, \['\/S'\]\)/);
});

test('spawn errors stay failures even if a later close arrives', async () => {
  const f = fixture();
  const promise = f.runCompiler('makensis.cmd', []);
  const error = new Error('spawn denied by policy');
  f.compiler.emit('error', error);
  f.compiler.close();
  await assert.rejects(promise, candidate => candidate === error);
  assert.equal(f.stops.length, 0);
});

test('synchronous runner exceptions reject immediately', async () => {
  const runner = createInstallerProcessRunner({ spawnCompiler: () => { throw new Error('spawn failed'); } });
  await assert.rejects(runner.runCompiler('makensis.cmd', []), /spawn failed/);
});

test('compiler timeout stops its owned tree and remains a failed run', async () => {
  const f = fixture();
  await assert.rejects(f.runCompiler('makensis.cmd', [], {}, 5), /Timed out: makensis.cmd/);
  assert.deepEqual(f.stops, [f.compiler]);
  assert.equal(f.compiler.kills, 0);
});

test('QA timeout kills only its own executable without compiler tree cleanup', async () => {
  const f = fixture();
  await assert.rejects(f.runExecutable('qa.exe', [], {}, 5), /Timed out: qa.exe/);
  assert.equal(f.executable.kills, 1);
  assert.equal(f.stops.length, 0);
});

test('compiler cleanup errors do not become a successful timeout exit', async () => {
  const child = new FakeChild();
  const runner = createInstallerProcessRunner({ spawnCompiler: () => child,
    stopCompiler: async () => { throw new Error('cleanup denied'); },
  });
  await assert.rejects(runner.runCompiler('makensis.cmd', [], {}, 5), /cleanup failed: cleanup denied/);
});

test('compiler cleanup targets only the owned live process ID with no shell', async () => {
  const compiler = new FakeChild();
  const cleanup = new FakeChild();
  const calls: unknown[][] = [];
  const promise = stopOwnedCompiler(compiler, (...args: unknown[]) => { calls.push(args); return cleanup; });
  cleanup.close();
  await promise;
  assert.deepEqual(calls, [[path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
    ['/PID', '12345', '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' }]]);
});

test('compiler cleanup does not target exited or invalid process IDs', async () => {
  const compiler = new FakeChild();
  let calls = 0;
  const unexpectedSpawn = () => { calls += 1; throw new Error('must not spawn'); };
  compiler.close();
  await stopOwnedCompiler(compiler, unexpectedSpawn);
  compiler.exitCode = null;
  compiler.pid = 0;
  await assert.rejects(stopOwnedCompiler(compiler, unexpectedSpawn), /owned process ID/);
  assert.equal(calls, 0);
});
