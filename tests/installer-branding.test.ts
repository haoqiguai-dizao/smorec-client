import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { assertInstallerBranding, assertInstallModeOverrides, verifyInstallerBranding } = require('../scripts/installer-branding.cjs');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

test('release installer configuration passes the effective-option and upstream callback guard', () => {
  assert.deepEqual(verifyInstallerBranding(process.cwd(), manifest.build, manifest), {
    productName: '小录', installDirectory: '小录', legacyUpgradeDirectory: 'preserved',
  });
});

test('packaging fails if effective overrides would lose folder branding or the verified callbacks', () => {
  const overrides = [
    { nsis: { include: undefined } }, { nsis: { include: 'unreviewed.nsh' } },
    { nsis: { unicode: false } }, { nsis: { oneClick: true } },
    { nsis: { allowToChangeInstallationDirectory: false } },
    { nsis: { script: 'replacement.nsi' } }, { beforePack: undefined },
    { productName: 'FrameFlow' }, { win: { executableName: 'FrameFlow' } },
  ];
  for (const override of overrides) {
    const config = { ...manifest.build, ...override,
      nsis: { ...manifest.build.nsis, ...override.nsis }, win: { ...manifest.build.win, ...override.win } };
    assert.throws(() => assertInstallerBranding(config, manifest), `Reject ${JSON.stringify(override)}`);
  }
});

test('folder renaming cannot silently create a second app identity or move the existing profile', () => {
  assert.throws(() => assertInstallerBranding({ ...manifest.build, appId: 'studio.smorec.new' }, manifest));
  assert.throws(() => assertInstallerBranding({ ...manifest.build, nsis: { ...manifest.build.nsis, guid: 'new-guid' } }, manifest));
  assert.throws(() => assertInstallerBranding(manifest.build, { ...manifest, name: 'smorec' }));
});

test('release builds cannot fall back to the legacy NSIS compiler or replace pinned plugins', () => {
  for (const toolsets of [undefined, {}, { nsis: '1.2.0' }]) {
    assert.throws(() => assertInstallerBranding({ ...manifest.build, toolsets }, manifest), /NSIS 3\.12/);
  }
  for (const field of ['customNsisBinary', 'customNsisResources']) {
    assert.throws(() => assertInstallerBranding({ ...manifest.build,
      nsis: { ...manifest.build.nsis, [field]: { url: 'https://example.invalid/nsis' } },
    }, manifest));
  }
});

test('release builds reject environment overrides for pinned NSIS binaries and plugins', () => {
  for (const name of ['ELECTRON_BUILDER_NSIS_DIR', 'ELECTRON_BUILDER_NSIS_RESOURCES_DIR']) {
    for (const value of ['C:\\Build Cache\\legacy-nsis', ' ']) {
      assert.throws(() => assertInstallerBranding(manifest.build, manifest, { [name]: value }),
        new RegExp(`${name} must not override`));
    }
    assert.doesNotThrow(() => assertInstallerBranding(manifest.build, manifest, { [name]: '' }));
  }
  assert.doesNotThrow(() => assertInstallerBranding(manifest.build, manifest, {}));
});

test('drive defaults must preserve the complete upstream upgrade and explicit-path branches', () => {
  const upstream = readFileSync('node_modules/app-builder-lib/templates/nsis/multiUser.nsh', 'utf8');
  const override = readFileSync('build/nsis/install-modes.nsh', 'utf8');
  assertInstallModeOverrides(upstream, override);
  for (const changed of [
    override.replace('ReadRegStr $perUserInstallationFolder HKCU', 'ReadRegStr $perUserInstallationFolder HKLM'),
    override.replace('!insertmacro GetDParameter $R0', 'StrCpy $R0 ""'),
    override.replace('!insertmacro SmoRecApplyPreferredDefault', ''),
  ]) assert.throws(() => assertInstallModeOverrides(upstream, changed));
  assert.throws(() => assertInstallModeOverrides(upstream.replace('SetShellVarContext current', 'SetShellVarContext all'), override));
});
