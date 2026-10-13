import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handoffWindowsInstall, prepareWindowsInstall, type WindowsInstallHandoff, type WindowsInstallPlan,
  type WindowsInstallRequest, type WindowsInstallerDependencies, type WindowsNsisUpdater,
} from '../electron/services/updates/windows-installer';
import {
  parseWindowsEnvironment, windowsProbeScript, type WindowsEnvironment,
} from '../electron/services/updates/windows-environment';

const directory = String.raw`D:\Program Files\小录 测试`;
const executable = directory + String.raw`\小录.exe`;
const resources = directory + String.raw`\resources`;
const camera = resources + String.raw`\virtual-camera\XiaoLu.VirtualCamera.dll`;
const installer = String.raw`C:\Users\测试 用户\AppData\Local\小录-updater\pending\安装.exe`;
const hash = 'ab'.repeat(32);
const key = (value: string) => value.toLowerCase();

function fixture() {
  let busy: boolean | undefined = false;
  let environment: WindowsEnvironment = { status: 'checked', permission: 'writable', processIds: [] };
  const files = new Map<string, { size: number; file?: boolean; symbolic?: boolean }>([
    [key(executable), { size: 10 }], [key(installer), { size: 100 }], [key(camera), { size: 20 }],
  ]);
  const aliases = new Map<string, string>();
  let digest = hash;
  let downloadedFile: string | undefined = installer;
  const events: string[] = [];
  const inspected: readonly string[][] = [];
  const inspections = inspected as string[][];
  const deps: WindowsInstallerDependencies = {
    platform: 'win32', processId: 1234,
    async realpath(file) { return aliases.get(key(file)) ?? file; },
    async stat(file) {
      const found = files.get(key(file));
      if (!found) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { size: found.size, isFile: () => found.file !== false, isSymbolicLink: () => found.symbolic === true };
    },
    async digest() { events.push('hash'); return digest; },
    async inspect(_directory, inspectedFiles) {
      events.push('inspect'); inspections.push([...inspectedFiles]); return environment;
    },
  };
  const request: WindowsInstallRequest = {
    installer: { path: installer, sha256: hash, size: 100 },
    currentExecutable: executable, resourcesPath: resources, isPackaged: true, isBusy: () => busy,
  };
  const updater: WindowsNsisUpdater = {
    autoInstallOnAppQuit: true,
    quitAndInstall(silent, restart) {
      assert.equal(silent, true); assert.equal(restart, true);
      assert.equal(updater.autoInstallOnAppQuit, false);
      events.push('quitAndInstall');
    },
  };
  const handoff: WindowsInstallHandoff = {
    getDownloadedFile: () => downloadedFile, isBusy: () => busy,
    async beforeQuit() { events.push('beforeQuit'); }, cancelQuit() { events.push('cancelQuit'); },
  };
  return {
    deps, request, updater, handoff, events, files, aliases, inspections,
    set busy(value: boolean | undefined) { busy = value; },
    set environment(value: WindowsEnvironment) { environment = value; },
    set digest(value: string) { digest = value; },
    set downloaded(value: string | undefined) { downloadedFile = value; },
    async plan() {
      const result = await prepareWindowsInstall(request, deps);
      assert.equal(result.status, 'ready');
      if (result.status !== 'ready') throw new Error('Expected ready');
      return result.plan;
    },
  };
}

test('preflight derives the actual Chinese/space installation directory and freezes its plan', async () => {
  const f = fixture();
  const plan = await f.plan();
  assert.equal(plan.installDirectory, directory); assert.ok(Object.isFrozen(plan));
  assert.deepEqual(f.inspections, [[camera]]);
  assert.equal(plan.elevationRequired, false);
});

test('actual executable realpath determines install directory rather than a launcher alias', async () => {
  const f = fixture(); const alias = String.raw`C:\Shortcuts\小录.exe`;
  f.aliases.set(key(alias), executable); f.request.currentExecutable = alias;
  assert.equal((await f.plan()).installDirectory, directory);
});

test('development and non-Windows runs never inspect or execute an installer', async () => {
  for (const development of [true, false]) {
    const f = fixture();
    if (development) f.request.isPackaged = false; else f.deps.platform = 'darwin';
    assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'unsupported' });
    assert.deepEqual(f.events, []);
  }
});

test('busy and unknown startup state defer before disk work', async () => {
  for (const busy of [true, undefined]) {
    const f = fixture(); f.busy = busy;
    assert.deepEqual(await prepareWindowsInstall(f.request, f.deps),
      { status: 'deferred', reason: busy ? 'busy' : 'state-unknown' });
    assert.deepEqual(f.events, []);
  }
  const f = fixture(); f.request.isBusy = () => { throw new Error('unknown'); };
  assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'state-unknown' });
});

test('starting a job during an asynchronous preflight blocks readiness', async () => {
  const f = fixture(); f.deps.digest = async () => { f.busy = true; return hash; };
  assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'busy' });
});

test('outside resources, root directory and wrong executable cannot choose an installation target', async () => {
  for (const kind of ['resources', 'root', 'name']) {
    const f = fixture();
    if (kind === 'resources') f.aliases.set(key(resources), String.raw`C:\Other\resources`);
    else {
      f.request.currentExecutable = kind === 'root' ? String.raw`C:\小录.exe` : directory + String.raw`\Other.exe`;
      f.files.set(key(f.request.currentExecutable), { size: 10 });
    }
    assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'invalid-installation' });
  }
});

test('installer must match the signed size and hash', async () => {
  for (const kind of ['hash', 'size']) {
    const f = fixture();
    if (kind === 'hash') f.digest = 'cd'.repeat(32); else f.request.installer.size = 101;
    assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'installer-mismatch' });
  }
});

test('invalid digest and oversized manifest files fail before reading content', async () => {
  for (const kind of ['hash', 'size', 'fraction']) {
    const f = fixture();
    if (kind === 'hash') f.request.installer.sha256 = 'not-a-sha256';
    else f.request.installer.size = kind === 'fraction' ? 1.5 : 5 * 1024 ** 3;
    assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'installer-mismatch' });
    assert.deepEqual(f.events, []);
  }
});

test('installer directories, symlinks and files inside the old install tree are rejected', async () => {
  for (const kind of ['directory', 'symlink', 'inside']) {
    const f = fixture();
    if (kind === 'directory') f.files.set(key(installer), { size: 100, file: false });
    if (kind === 'symlink') f.files.set(key(installer), { size: 100, symbolic: true });
    if (kind === 'inside') f.aliases.set(key(installer), directory + String.raw`\pending.exe`);
    assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'installer-mismatch' });
  }
});

test('UNC, relative, alternate streams and control characters are not executable paths', async () => {
  for (const value of [String.raw`\\server\share\installer.exe`, 'installer.exe', installer + ':payload', installer + '\n', 'C:\\a"b.exe']) {
    const f = fixture(); f.request.installer.path = value;
    assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'installer-mismatch' });
  }
});

test('a vanished cached installer is unavailable and never launched', async () => {
  const f = fixture(); f.files.delete(key(installer));
  assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'installer-unavailable' });
});

test('previous versions without a virtual camera can still be preflighted', async () => {
  const f = fixture(); f.files.delete(key(camera)); await f.plan();
  assert.deepEqual(f.inspections, [[]]);
});

test('camera access errors and redirected camera files are unknown, not absence', async () => {
  for (const kind of ['denied', 'redirected']) {
    const f = fixture();
    if (kind === 'redirected') f.aliases.set(key(camera), String.raw`C:\Other\camera.dll`);
    else {
      const stat = f.deps.stat;
      f.deps.stat = file => file === camera
        ? Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })) : stat(file);
    }
    assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'environment-unknown' });
  }
});

test('mapped camera consumers do not block NSIS atomic replacement', async () => {
  const f = fixture();
  f.environment = { status: 'checked', permission: 'writable', processIds: [1234] };
  await f.plan();
  f.environment = { status: 'checked', permission: 'writable', processIds: [1234, 888] };
  assert.equal((await prepareWindowsInstall(f.request, f.deps)).status, 'ready');
});

test('probe failure or unknown permissions do not guess that installation is safe', async () => {
  for (const result of [{ status: 'unknown' }, { status: 'checked', permission: 'unknown', processIds: [] }] as WindowsEnvironment[]) {
    const f = fixture(); f.environment = result;
    assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'environment-unknown' });
  }
  const f = fixture(); f.deps.inspect = async () => { throw new Error('denied'); };
  assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'environment-unknown' });
});

test('Program Files elevation requires explicit idle-startup policy and never self-elevates', async () => {
  const f = fixture(); f.environment = { status: 'checked', permission: 'elevation-required', processIds: [] };
  assert.deepEqual(await prepareWindowsInstall(f.request, f.deps), { status: 'deferred', reason: 'elevation-required' });
  f.request.allowElevation = true;
  assert.equal((await f.plan()).elevationRequired, true);
  assert.ok(!f.events.includes('quitAndInstall'));
});

test('public updater handoff waits for cleanup and supplies the exact unquoted installation path', async () => {
  const f = fixture(); const plan = await f.plan(); f.events.length = 0;
  f.handoff.beforeQuit = async () => {
    await Promise.resolve(); f.events.push('cleanup-complete');
    assert.ok(!f.events.includes('quitAndInstall'));
  };
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps), { status: 'handoff-requested' });
  assert.equal(f.updater.installDirectory, directory);
  assert.deepEqual(f.events, ['hash', 'inspect', 'cleanup-complete', 'hash', 'inspect', 'quitAndInstall']);
});

test('a plan cannot be forged or deserialized across launches', async () => {
  const f = fixture(); const plan = await f.plan();
  assert.deepEqual(await handoffWindowsInstall({ ...plan } as WindowsInstallPlan, f.updater, f.handoff, f.deps),
    { status: 'deferred', reason: 'invalid-installation' });
});

test('updater downloaded path must identify the verified package', async () => {
  const f = fixture(); const plan = await f.plan(); f.downloaded = String.raw`C:\other.exe`;
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps),
    { status: 'deferred', reason: 'download-changed' });
  assert.ok(!f.events.includes('beforeQuit'));
});

test('tampering after preparation never reaches cleanup or NSIS', async () => {
  const f = fixture(); const plan = await f.plan(); f.digest = 'cd'.repeat(32);
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps),
    { status: 'deferred', reason: 'installer-mismatch' });
  assert.ok(!f.events.includes('beforeQuit'));
});

test('new mapped DLL consumers before handoff do not prevent installation', async () => {
  const f = fixture(); const plan = await f.plan();
  f.environment = { status: 'checked', permission: 'writable', processIds: [999] };
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps),
    { status: 'handoff-requested' });
  assert.ok(f.events.includes('beforeQuit'));
});

test('new busy state during cleanup cancels the startup reservation', async () => {
  const f = fixture(); const plan = await f.plan();
  f.handoff.beforeQuit = async () => { f.busy = true; };
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps), { status: 'deferred', reason: 'busy' });
  assert.ok(f.events.includes('cancelQuit')); assert.ok(!f.events.includes('quitAndInstall'));
});

test('download replacement during cleanup cancels the startup reservation', async () => {
  const f = fixture(); const plan = await f.plan();
  f.handoff.beforeQuit = async () => { f.downloaded = undefined; };
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps), { status: 'deferred', reason: 'download-changed' });
  assert.ok(f.events.includes('cancelQuit'));
});

test('a mapped DLL consumer starting during cleanup does not require termination', async () => {
  const f = fixture(); const plan = await f.plan();
  f.handoff.beforeQuit = async () => { f.environment = { status: 'checked', permission: 'writable', processIds: [999] }; };
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps),
    { status: 'handoff-requested' });
  assert.ok(!f.events.includes('cancelQuit')); assert.ok(f.events.includes('quitAndInstall'));
});

test('package contents are checked again after cleanup', async () => {
  const f = fixture(); const plan = await f.plan();
  f.handoff.beforeQuit = async () => { f.digest = 'cd'.repeat(32); };
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps),
    { status: 'deferred', reason: 'installer-mismatch' });
  assert.ok(f.events.includes('cancelQuit'));
});

test('cleanup or synchronous updater failure releases the reservation and reports failure', async () => {
  for (const kind of ['cleanup', 'updater']) {
    const f = fixture(); const plan = await f.plan();
    if (kind === 'cleanup') f.handoff.beforeQuit = async () => { throw new Error('Synthetic cleanup'); };
    else f.updater.quitAndInstall = () => { throw new Error('Synthetic updater'); };
    assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps),
      { status: 'failed', error: 'Synthetic ' + kind });
    assert.ok(f.events.includes('cancelQuit'));
  }
});

test('cleanup and reservation-release failures are both retained', async () => {
  const f = fixture(); const plan = await f.plan();
  f.handoff.beforeQuit = async () => { throw new Error('cleanup'); };
  f.handoff.cancelQuit = () => { throw new Error('release'); };
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps),
    { status: 'failed', error: 'cleanup; release' });
});

test('concurrent apply requests cannot invoke two installers', async () => {
  const f = fixture(); const plan = await f.plan();
  let release!: () => void;
  const entered = new Promise<void>(resolve => {
    f.handoff.beforeQuit = () => { resolve(); return new Promise<void>(resume => { release = resume; }); };
  });
  const first = handoffWindowsInstall(plan, f.updater, f.handoff, f.deps);
  await entered;
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps), { status: 'deferred', reason: 'busy' });
  release(); assert.deepEqual(await first, { status: 'handoff-requested' });
  assert.equal(f.events.filter(event => event === 'quitAndInstall').length, 1);
});

test('failed preflight allows a later idle retry on the same updater', async () => {
  const f = fixture(); const plan = await f.plan(); f.busy = true;
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps), { status: 'deferred', reason: 'busy' });
  f.busy = false;
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps), { status: 'handoff-requested' });
});

test('environment output is bounded, validates process IDs and deduplicates owners', () => {
  assert.deepEqual(parseWindowsEnvironment('\uFEFF {"status":"checked","permission":"writable","processIds":[1,1,2]}'),
    { status: 'checked', permission: 'writable', processIds: [1, 2] });
  for (const output of ['', 'null', '{}', 'garbage', '{"status":"checked","permission":"unexpected","processIds":[]}']) {
    assert.deepEqual(parseWindowsEnvironment(output), { status: 'unknown' });
  }
  for (const processIds of [[0], [-1], [2 ** 32], ['1'], [1.5], Array(513).fill(1)]) {
    assert.deepEqual(parseWindowsEnvironment(JSON.stringify({ status: 'checked', permission: 'writable', processIds })),
      { status: 'unknown' });
  }
});

test('Windows probe paths remain encoded data and no process-control API is included', () => {
  const unusual = "D:\\Chinese 空格\\O'Hare $(bad) `literal";
  const script = windowsProbeScript(unusual, [unusual + '\\camera.dll']);
  assert.ok(!script.includes(unusual));
  assert.doesNotMatch(script, /RmShutdown|RmRestart|Stop-Process|taskkill|Start-Process/);
  const encoded = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(script)?.[1];
  assert.ok(encoded);
  assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')),
    { installDirectory: unusual, files: [unusual + '\\camera.dll'] });
  assert.match(script, /RmEndSession/);
});

test('synchronous public updater error events are failures even when quitAndInstall returns void', async () => {
  const f = fixture(); const plan = await f.plan();
  const listeners = new Set<(error: Error) => void>();
  f.updater.on = (_event, listener) => listeners.add(listener);
  f.updater.removeListener = (_event, listener) => listeners.delete(listener);
  f.updater.quitAndInstall = () => { for (const listener of listeners) listener(new Error('NSIS not ready')); };
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps),
    { status: 'failed', error: 'NSIS not ready' });
  assert.equal(listeners.size, 0); assert.ok(f.events.includes('cancelQuit'));
});

test('download identity is checked after the last asynchronous environment probe', async () => {
  const f = fixture(); const plan = await f.plan();
  const inspect = f.deps.inspect; let count = 0;
  f.deps.inspect = async (...args) => {
    const result = await inspect(...args);
    if (++count === 2) f.downloaded = undefined;
    return result;
  };
  assert.deepEqual(await handoffWindowsInstall(plan, f.updater, f.handoff, f.deps),
    { status: 'deferred', reason: 'download-changed' });
  assert.ok(f.events.includes('cancelQuit')); assert.ok(!f.events.includes('quitAndInstall'));
});
