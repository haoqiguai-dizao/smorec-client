import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { isZipOnlyBuild } = require('../scripts/installer-targets.cjs');
const { verifyInstallerBranding } = require('../scripts/installer-branding.cjs');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const hookSource = readFileSync('scripts/before-pack.cjs', 'utf8');

function loadHook(exitCode = 0) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const messages: string[] = [];
  let brandingChecks = 0;
  const module = { exports: undefined as unknown };
  vm.runInNewContext(hookSource, {
    module,
    require: (name: string) => {
      if (name === './installer-branding.cjs') return {
        verifyInstallerBranding: (...args: unknown[]) => {
          brandingChecks += 1;
          return verifyInstallerBranding(...args);
        },
      };
      if (name === './installer-targets.cjs') return { isZipOnlyBuild };
      if (name === 'node:path') return path;
      if (name === 'node:child_process') return {
        spawn: (command: string, args: string[]) => {
          calls.push({ command, args: Array.from(args) });
          const child = new EventEmitter();
          queueMicrotask(() => child.emit('exit', exitCode));
          return child;
        },
      };
      throw new Error(`Unexpected hook dependency: ${name}`);
    },
    process: { platform: 'win32', execPath: process.execPath },
    console: { log: (message: string) => messages.push(message) },
  });
  return {
    run: module.exports as (context: unknown) => Promise<void>,
    calls,
    messages,
    get brandingChecks() { return brandingChecks; },
  };
}

function context(targets: unknown, config = manifest.build) {
  return { electronPlatformName: 'win32', targets, packager: {
    projectDir: process.cwd(), config, info: { metadata: manifest },
  } };
}

test('only explicit, nonempty ZIP-only targets exclude installer runtime QA', () => {
  assert.equal(isZipOnlyBuild([{ name: 'zip' }]), true);
  assert.equal(isZipOnlyBuild([{ name: 'zip' }, { name: 'zip' }]), true);
  for (const targets of [
    undefined, null, [], new Array(1), {}, ['zip'], [null], [{}],
    [{ name: 'ZIP' }], [{ name: 'unknown' }], [{ name: 'dir' }],
    [{ name: 'nsis' }], [{ name: 'nsis-web' }], [{ name: 'portable' }],
    [{ name: 'zip' }, { name: 'nsis' }], [{ name: 'zip' }, undefined],
  ]) assert.equal(isZipOnlyBuild(targets), false);
});

test('ZIP-only beforePack retains static guards without spawning native QA', async () => {
  const hook = loadHook();
  await hook.run(context([{ name: 'zip' }]));
  assert.equal(hook.brandingChecks, 1);
  assert.equal(hook.calls.length, 0);
  assert.match(hook.messages.join('\n'), /native installer directory QA not applicable to ZIP-only/);
});

test('ZIP-only cannot bypass branding or upgrade-identity validation', async () => {
  for (const config of [
    { ...manifest.build, appId: 'different.app' },
    { ...manifest.build, beforePack: undefined },
    { ...manifest.build, nsis: { ...manifest.build.nsis, include: undefined } },
  ]) {
    const hook = loadHook();
    await assert.rejects(hook.run(context([{ name: 'zip' }], config)));
    assert.equal(hook.brandingChecks, 1);
    assert.equal(hook.calls.length, 0);
    assert.equal(hook.messages.length, 0);
  }
});

test('all other Windows targets retain the native QA hook', async () => {
  for (const targets of [
    undefined, [], [{ name: 'dir' }], [{ name: 'unknown' }],
    [{ name: 'nsis' }], [{ name: 'nsis-web' }], [{ name: 'portable' }],
    [{ name: 'zip' }, { name: 'nsis' }],
  ]) {
    const hook = loadHook();
    await hook.run(context(targets));
    assert.equal(hook.brandingChecks, 1);
    assert.deepEqual(hook.calls, [{ command: process.execPath,
      args: [path.join(process.cwd(), 'scripts/verify-installer-directory.mjs')] }]);
    assert.doesNotMatch(hook.messages.join('\n'), /not applicable/);
  }
});

test('native QA failure remains fatal for installer builds', async () => {
  const hook = loadHook(1);
  await assert.rejects(hook.run(context([{ name: 'nsis' }])), /Installer directory regression failed \(1\)/);
  assert.equal(hook.calls.length, 1);
  assert.equal(hook.messages.length, 0);
});

test('ZIP and directory targets remain explicit and NSIS packaging cannot publish unsigned feeds', () => {
  assert.equal(manifest.scripts['package:zip'], 'npm run build && npm run native:build && electron-builder --win zip --x64');
  assert.equal(manifest.scripts['package:win'], 'npm run build && npm run native:build && electron-builder --win nsis --x64 --publish never && python scripts/build-app-update.py');
  assert.equal(manifest.scripts['package:dir'], 'npm run build && npm run native:build && electron-builder --win --dir --x64');
});
