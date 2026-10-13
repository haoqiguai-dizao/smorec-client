import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import type { SignedRelease, UpdateConfiguration } from '../shared/update-types';
import { canonicalJson } from '../electron/services/updates/manifest';
import { command, extractBundle, validateEntries, verifyArchive } from '../electron/services/updates/mac/bundle';
import { locations, sleep, writeJson, type MacPlan } from '../electron/services/updates/mac/paths';
import { recoverMacUpdate, stageMacUpdate } from '../electron/services/updates/mac/apply';
import { handoffMacInstall } from '../electron/services/updates/mac-install';

test('Mac archive paths reject traversal, foreign roots and control characters', () => {
  validateEntries('小录.app/\n小录.app/Contents/MacOS/小录\n', '小录.app');
  for (const list of ['../小录.app/a', '小录.app/../escape', '/小录.app/a', '别的.app/a', '小录.app/a\rb']) {
    assert.throws(() => validateEntries(list, '小录.app'));
  }
});

test('busy Mac handoff never starts a helper or requests quit', async () => {
  const outcome = await handoffMacInstall({} as never, { executable: '', args: [], busy: () => true,
    beforeQuit: async () => assert.fail('must not quit'), cancelQuit: () => {}, quit: () => assert.fail('must not quit') });
  assert.deepEqual(outcome, { status: 'deferred', reason: 'busy' });
});

test('real ad-hoc Mac bundles verify, replace, confirm and roll back a failed launch', { skip: process.platform !== 'darwin', timeout: 180000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-mac-update-')));
  const children: ChildProcess[] = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    const processes = (await command('/bin/ps', ['-axo', 'pid=,comm='])).stdout;
    for (const row of processes.split('\n')) {
      const match = /^\s*(\d+)\s+(.+)$/.exec(row);
      if (match && match[2].startsWith(root + path.sep)) {
        try { process.kill(Number(match[1]), 'SIGTERM'); } catch { /* Already exited. */ }
      }
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'main.swift');
  await fs.writeFile(source, `import AppKit
import Foundation
let bundle = Bundle.main
if (try? String(contentsOf: bundle.bundleURL.appendingPathComponent("Contents/Resources/behavior"), encoding: .utf8)) == "fail" { exit(1) }
if let arg = CommandLine.arguments.first(where: { $0.hasPrefix("--mac-update-session=") }) {
 let session = String(arg.dropFirst("--mac-update-session=".count))
 let value: [String: Any] = ["session": session, "pid": ProcessInfo.processInfo.processIdentifier, "version": bundle.infoDictionary!["CFBundleShortVersionString"]!]
 try JSONSerialization.data(withJSONObject: value).write(to: URL(fileURLWithPath: session + "/health.json"), options: .atomic)
}
NSApplication.shared.setActivationPolicy(.prohibited)
NSApplication.shared.run()
`);
  const binary = path.join(root, 'binary'); await command('/usr/bin/swiftc', [source, '-o', binary]);
  const launcher = path.join(root, 'launcher');
  await command('/usr/bin/swiftc', ['native/macos/Sources/AppLaunch/main.swift', '-o', launcher]);
  // Production helpers run Electron as Node. This variable must not leak into
  // the LaunchServices app or change an Electron application's startup mode.
  const updaterEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_RENDERER_URL: 'https://example.invalid' };
  const cleanLaunch = await promisify(execFile)(launcher, [await makeProbeApp(), '[]'], { env: updaterEnv });
  const probe = JSON.parse(cleanLaunch.stdout); assert.ok(probe.pid > 1); process.kill(probe.pid, 'SIGTERM');
  async function makeProbeApp() {
    const folder = path.join(root, 'environment-probe/小录.app');
    await fs.mkdir(path.join(folder, 'Contents/MacOS'), { recursive: true });
    const probeSource = path.join(root, 'environment.swift');
    await fs.writeFile(probeSource, `import AppKit
import Foundation
if getenv("ELECTRON_RUN_AS_NODE") != nil || getenv("ELECTRON_RENDERER_URL") != nil { exit(9) }
NSApplication.shared.setActivationPolicy(.prohibited)
NSApplication.shared.run()
`);
    await command('/usr/bin/swiftc', [probeSource, '-o', path.join(folder, 'Contents/MacOS/小录')]);
    const plist = path.join(folder, 'Contents/Info.plist');
    await fs.writeFile(plist, JSON.stringify({ CFBundleIdentifier: 'studio.frameflow.desktop', CFBundleExecutable: '小录',
      CFBundlePackageType: 'APPL', CFBundleShortVersionString: '0.9.17', LSUIElement: true }));
    await command('/usr/bin/plutil', ['-convert', 'xml1', plist]);
    await command('/usr/bin/codesign', ['--force', '--sign', '-', folder]);
    return folder;
  }
  async function makeApp(folder: string, version: string, behavior = 'healthy') {
    const app = path.join(root, folder, '小录.app');
    await fs.mkdir(path.join(app, 'Contents/MacOS'), { recursive: true }); await fs.mkdir(path.join(app, 'Contents/Resources'));
    await fs.copyFile(binary, path.join(app, 'Contents/MacOS/小录'));
    await fs.mkdir(path.join(app, 'Contents/Resources/native'), { recursive: true });
    await fs.copyFile(launcher, path.join(app, 'Contents/Resources/native/XiaoLu.Launch'));
    const plist = path.join(app, 'Contents/Info.plist');
    await fs.writeFile(plist, JSON.stringify({ CFBundleIdentifier: 'studio.frameflow.desktop', CFBundleExecutable: '小录',
      CFBundleName: '小录', CFBundleDisplayName: '小录', LSUIElement: true,
      CFBundlePackageType: 'APPL', CFBundleShortVersionString: version, CFBundleVersion: version }));
    await command('/usr/bin/plutil', ['-convert', 'xml1', plist]);
    await fs.writeFile(path.join(app, 'Contents/Resources/behavior'), behavior);
    await command('/usr/bin/codesign', ['--force', '--sign', '-', app]); return app;
  }
  const target = await makeApp('installed', '0.9.17');
  const next = await makeApp('next', '0.9.18');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const config: UpdateConfiguration = { serviceUrl: 'https://example.test', channel: 'stable', publicKeys: {
    test: publicKey.export({ type: 'spki', format: 'pem' }).toString() } };
  async function planFor(app: string) {
    const session = path.join(root, 'mac-session-' + randomUUID()); await fs.mkdir(session);
    const archive = path.join(session, 'app-update.zip');
    await command('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', app, archive]);
    const bytes = await fs.readFile(archive);
    const artifact = { platform: 'darwin' as const, arch: 'arm64' as const, size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), sha512: createHash('sha512').update(bytes).digest('base64') };
    const payload: SignedRelease['payload'] = { product: 'smorec', channel: 'stable', version: '0.9.18', publishedAt: new Date().toISOString(),
      releaseNotes: '本地验收', artifacts: [], macArtifacts: ['zip', 'dmg'].map(ext => ({ ...artifact, name: '小录.' + ext, url: 'https://example.test/app.' + ext })) };
    const release: SignedRelease = { schema: 1, keyId: 'test', payload, signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64') };
    const plan: MacPlan = { session, target, release };
    const file = path.join(session, 'plan.json'); await writeJson(file, plan); return { plan, file, artifact };
  }
  const valid = await planFor(next); await stageMacUpdate(valid.file, config);
  const tampered = await planFor(next); await fs.appendFile(locations(tampered.plan).archive, 'tampered');
  await assert.rejects(verifyArchive(locations(tampered.plan).archive, { ...tampered.artifact, name: '小录.zip', url: 'https://example.test/app.zip' }), /大小/);
  const unsigned = await planFor(next); unsigned.plan.release.signature = 'A'.repeat(86) + '=='; await writeJson(unsigned.file, unsigned.plan);
  await assert.rejects(stageMacUpdate(unsigned.file, config), /签名/);
  const wrong = await makeApp('wrong', '0.9.19'); const wrongPlan = await planFor(wrong);
  await assert.rejects(stageMacUpdate(wrongPlan.file, config), /版本/);
  // Recover a crash precisely between moving the old bundle and installing the candidate.
  const interrupted = await planFor(next), interruptedFiles = locations(interrupted.plan);
  await fs.rename(target, interruptedFiles.backup);
  await writeJson(interruptedFiles.journal, { state: 'swapping', helperPid: 1073741824 });
  assert.equal(await recoverMacUpdate(interrupted.file, config), 'recovered');
  assert.ok(await fs.stat(target));
  // libarchive must refuse writing a later ZIP member through an earlier escaping symlink.
  const escapeZip = path.join(root, 'escape.zip'), escaped = path.join(root, 'outside');
  await fs.mkdir(escaped);
  await command('/usr/bin/python3', ['-c', `import zipfile,sys
with zipfile.ZipFile(sys.argv[1], 'w') as z:
 i=zipfile.ZipInfo('小录.app/link');i.create_system=3;i.external_attr=(0o120777 << 16)
 z.writestr(i, '../../outside');z.writestr('小录.app/link/pwn', 'unsafe')
`, escapeZip]);
  await assert.rejects(extractBundle(escapeZip, path.join(root, 'escape-stage'), '小录.app'));
  assert.equal(await fs.access(path.join(escaped, 'pwn')).then(() => true, () => false), false);
  const helper = path.join(root, 'helper.cjs');
  await build({ entryPoints: ['electron/mac-update-helper.ts'],
    bundle: true, platform: 'node', format: 'cjs', outfile: helper, logLevel: 'silent',
    plugins: [{ name: 'test-signing-key', setup(builder) {
      builder.onLoad({ filter: /config[/\\]distribution\.json$/ }, () => ({ loader: 'json', contents: JSON.stringify(config) }));
    } }] });
  const finderEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'LANG' && key !== 'LANGUAGE' && !key.startsWith('LC_')));
  for (const env of [finderEnv, { ...finderEnv, LANG: 'C', LC_ALL: 'C' }]) {
    const staged = await planFor(next);
    const result = await promisify(execFile)(process.execPath, [helper, 'stage', staged.file], { env });
    assert.equal(result.stdout.trim(), 'staged', 'real helper must accept Chinese bundle names without a UTF-8 parent locale');
  }
  async function runUpdate(item: Awaited<ReturnType<typeof planFor>>) {
    const parent = spawn('/bin/sleep', ['120']); children.push(parent);
    item.plan.parentId = parent.pid; await writeJson(item.file, item.plan);
    const child = spawn(process.execPath, [helper, 'apply', item.file], { env: finderEnv, stdio: ['ignore', 'ignore', 'pipe'] }); children.push(child);
    let stderr = ''; child.stderr!.on('data', bytes => { stderr += String(bytes); });
    const files = locations(item.plan);
    for (let n = 0; n < 600 && !await fs.access(files.ready).then(() => true, () => false); n++) {
      if (child.exitCode !== null) assert.fail(stderr); await sleep(50);
    }
    assert.ok(await fs.readFile(files.ready));
    await fs.writeFile(files.commit, 'apply'); parent.kill('SIGTERM');
    for (let n = 0; n < 1200 && child.exitCode === null; n++) await sleep(50);
    assert.notEqual(child.exitCode, null, stderr);
    const journal = JSON.parse(await fs.readFile(files.journal, 'utf8'));
    assert.ok(['confirmed', 'rolled-back'].includes(journal.state), stderr);
    return journal;
  }
  assert.equal((await runUpdate(valid)).state, 'confirmed');
  const health = JSON.parse(await fs.readFile(locations(valid.plan).health, 'utf8')); process.kill(health.pid, 'SIGTERM');
  assert.equal(await fs.access(locations(valid.plan).backup).then(() => true, () => false), false);
  const failed = await makeApp('failed', '0.9.18', 'fail'); const failedPlan = await planFor(failed);
  const rolledBack = await runUpdate(failedPlan);
  assert.equal(rolledBack.state, 'rolled-back');
  if (rolledBack.childPid) process.kill(rolledBack.childPid, 'SIGTERM');
  assert.equal(await fs.readFile(path.join(target, 'Contents/Resources/behavior'), 'utf8'), 'healthy');
  assert.equal(await recoverMacUpdate(failedPlan.file, config), 'rolled-back');
  // Stop the restored test app via its recorded exact executable path, never other applications.
  const output = (await command('/bin/ps', ['-axo', 'pid=,command='])).stdout;
  for (const line of output.split('\n')) if (line.includes(path.join(target, 'Contents/MacOS/小录'))) {
    const pid = Number(line.trim().split(/\s+/)[0]); if (pid > 1) process.kill(pid, 'SIGTERM');
  }
});
