const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Validate effective builder options, including command-line overrides, on every build. */
function assertInstallerBranding(config, metadata, environment = process.env) {
  assert.equal(metadata.name, 'frameflow-studio', 'Preserve the existing profile/package identity');
  assert.equal(config.appId, 'studio.frameflow.desktop', 'Preserve the existing upgrade identity');
  assert.equal(config.productName, '小录', 'Windows product name must be 小录');
  assert.equal(config.win?.executableName, '小录', 'Windows executable name must be 小录');
  assert.equal(config.nsis?.include, 'build/installer-branding.nsh', 'The branded NSIS include must remain enabled');
  assert.equal(config.nsis?.unicode, true, 'Chinese installation paths require Unicode NSIS');
  assert.equal(config.nsis?.oneClick, false, 'Directory verification covers assisted installers');
  assert.equal(config.nsis?.allowToChangeInstallationDirectory, true, 'Keep the verified directory-page callback');
  assert.equal(config.toolsets?.nsis, '1.2.1', 'Use the pinned NSIS 3.12 security-updated toolset');
  assert.ok(!config.nsis?.customNsisBinary, 'A custom NSIS binary requires separate security and runtime verification');
  assert.ok(!config.nsis?.customNsisResources, 'Keep plugins from the pinned NSIS toolset');
  for (const name of ['ELECTRON_BUILDER_NSIS_DIR', 'ELECTRON_BUILDER_NSIS_RESOURCES_DIR']) {
    assert.ok(!environment[name], `${name} must not override the pinned NSIS toolset`);
  }
  assert.ok(!config.nsis?.script, 'A replacement NSIS script needs its own directory/upgrade verification');
  assert.ok(!config.nsis?.guid, 'Derive the existing installer GUID from its stable appId');
  assert.equal(config.beforePack, './scripts/before-pack.cjs', 'Keep the installer guard in the builder lifecycle');
}

/** Preserve every upstream mode operation except the fresh-install default call. */
function assertInstallModeOverrides(upstream, override) {
  const defaultLine = '      StrCpy $INSTDIR "$0\\${APP_FILENAME}"';
  for (const name of ['setInstallModePerUser', 'setInstallModePerAllUsers']) {
    const pattern = new RegExp(`  !macro ${name}\\b[\\s\\S]*?  !macroend`);
    const original = upstream.replaceAll('\r\n', '\n').match(pattern)?.[0];
    const actual = override.replaceAll('\r\n', '\n').match(pattern)?.[0];
    assert.ok(original, `Missing upstream ${name}`);
    assert.equal(original.split(defaultLine).length, 2, `Review the updated ${name} default branch`);
    assert.equal(actual, original.replace(defaultLine, `${defaultLine}\n      !insertmacro SmoRecApplyPreferredDefault`),
      `${name} must preserve upstream upgrade, elevation and explicit-directory behavior`);
    assert.ok(override.includes(`!macroundef ${name}`), `Replace ${name} before installer mode expansion`);
  }
}

function verifyInstallerBranding(root, config, metadata) {
  assertInstallerBranding(config, metadata);
  const include = fs.readFileSync(path.join(root, config.nsis.include), 'utf8');
  assert.match(include, /!define APP_FILENAME "\$\{SMOREC_INSTALL_DIRECTORY\}"/);
  assert.match(include, /!define MUI_PAGE_CUSTOMFUNCTION_PRE smorecInstFilesPre/);
  assert.match(include, /!include "\$\{BUILD_RESOURCES_DIR\}\\nsis\\preferred-drive\.nsh"/);
  assert.match(include, /!macro customWelcomePage\s+!include "\$\{BUILD_RESOURCES_DIR\}\\nsis\\install-modes\.nsh"\s+!macroend/);
  const directory = fs.readFileSync(path.join(root, 'build/nsis/install-directory.nsh'), 'utf8');
  assert.match(directory, /!define SMOREC_INSTALL_DIRECTORY "小录"/);
  const library = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [root] }));
  const assisted = fs.readFileSync(path.join(library, 'templates/nsis/assistedInstaller.nsh'), 'utf8');
  assert.match(assisted, /!insertmacro customWelcomePage[\s\S]+!insertmacro PAGE_INSTALL_MODE/,
    'Install-mode overrides must load before the mode page expands');
  const installer = fs.readFileSync(path.join(library, 'templates/nsis/installer.nsi'), 'utf8');
  assert.match(installer, /!include "multiUser.nsh"[\s\S]+!include "assistedInstaller.nsh"[\s\S]+!insertmacro initMultiUser/,
    'Review the upstream installer initialization order');
  assert.match(assisted, /!define MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre[\s\S]+!insertmacro customPageAfterChangeDir[\s\S]+!insertmacro MUI_PAGE_INSTFILES/,
    'NSIS callback order changed; review the upstream template before packaging');
  const modes = fs.readFileSync(path.join(library, 'templates/nsis/multiUser.nsh'), 'utf8');
  const override = fs.readFileSync(path.join(root, 'build/nsis/install-modes.nsh'), 'utf8');
  assertInstallModeOverrides(modes, override);
  assert.match(override, /!insertmacro SmoRecGetPreferredInstallDirectory \$R0/);
  assert.equal((modes.match(/StrCpy \$INSTDIR "\$0\\\$\{APP_FILENAME\}"/g) ?? []).length, 2,
    'Both first-install modes must use the branded directory');
  for (const registry of ['HKCU', 'HKLM']) {
    assert.ok(modes.includes(`${registry} "\${INSTALL_REGISTRY_KEY}" InstallLocation`),
      'Both upgrade modes must preserve the recorded InstallLocation');
  }
  return { productName: config.productName, installDirectory: '小录', legacyUpgradeDirectory: 'preserved' };
}

module.exports = { assertInstallerBranding, assertInstallModeOverrides, verifyInstallerBranding };
