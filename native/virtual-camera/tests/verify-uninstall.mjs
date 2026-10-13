import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createInstallerProcessRunner } from '../../../scripts/installer-verification/process-runner.mjs';

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows.js');
const { runCompiler, runExecutable } = createInstallerProcessRunner({ cwd: root });
const packageInfo = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const output = await fs.mkdtemp(path.join(root, 'output/live-mode/uninstall-'));
const include = path.join(root, 'build/nsis/virtual-camera-uninstall.nsh');
const templates = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis');
const uninstaller = await fs.readFile(path.join(templates, 'uninstaller.nsh'), 'utf8');
const installUtil = await fs.readFile(path.join(templates, 'include/installUtil.nsh'), 'utf8');
assert.ok(uninstaller.indexOf('!insertmacro customUnInstall') < uninstaller.indexOf('# delete the installed files'),
  'Camera removal must finish before upstream deletes files');
assert.match(installUtil, /StrCpy \$0 "\$0 --updated"[\s\S]+ExecWait[^\r\n]+\$0 _\?=\$installationDir/,
  'The upgrade uninstaller must receive --updated');
const compiler = await getMakeNsisPath(packageInfo.build.toolsets.nsis);
const fixtures = [
  { name: 'successful-removal', updated: false, helper: true, code: 0, expected: 0, called: true },
  { name: 'registration-failure', updated: false, helper: true, code: 1, expected: 1, called: true },
  { name: 'cancelled-elevation', updated: false, helper: true, code: 1223, expected: 1, called: true },
  { name: 'upgrade-keeps-registration', updated: true, helper: true, code: 1, expected: 0, called: false },
  { name: 'missing-helper-preserves-dll', updated: false, helper: false, dll: true, code: 1, expected: 1, called: false },
  { name: 'old-installation-without-camera', updated: false, helper: false, code: 1, expected: 0, called: false },
];
for (const fixture of fixtures) {
  const directory = path.join(output, fixture.name);
  const install = path.join(directory, '小录');
  const resources = path.join(install, 'resources/virtual-camera');
  await fs.mkdir(resources, { recursive: true });
  if (fixture.helper) await fs.copyFile(path.join(root, 'native/virtual-camera/obj/x64/uninstall-fixture.exe'), path.join(resources, 'XiaoLu.CameraBridge.exe'));
  if (fixture.dll) await fs.writeFile(path.join(resources, 'XiaoLu.VirtualCamera.dll'), 'isolated-uninstall-fixture');
  await fs.writeFile(path.join(resources, 'exit-code.txt'), String(fixture.code));
  const executable = path.join(directory, 'uninstall-macro-test.exe');
  const script = path.join(directory, 'uninstall-macro-test.nsi');
  await fs.writeFile(script, `\uFEFFUnicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${executable}"
!include LogicLib.nsh
!define isUpdated '"${fixture.updated ? 'yes' : 'no'}" == "yes"'
!include "${include}"
Section
  SetRegView 64
  StrCpy $INSTDIR "${install}"
  !insertmacro customUnInstall
  FileOpen $R0 "${directory}\\continued.txt" w
  FileWrite $R0 "files-may-be-removed"
  FileClose $R0
  SetErrorLevel 0
SectionEnd
`, 'utf8');
  const compiled = await runCompiler(compiler.path, ['/V2', '/INPUTCHARSET', 'UTF8', script], compiler.env);
  assert.equal(compiled.code, 0, compiled.stdout + compiled.stderr);
  const result = await runExecutable(executable, ['/S']);
  assert.equal(result.code, fixture.expected, fixture.name);
  const exists = async file => fs.access(file).then(() => true, () => false);
  assert.equal(await exists(path.join(directory, 'continued.txt')), fixture.expected === 0, fixture.name + ': file removal gate');
  assert.equal(await exists(path.join(resources, 'invoked.txt')), fixture.called, fixture.name + ': camera cleanup dispatch');
}
console.log(JSON.stringify({ passed: true, cases: fixtures.length, output, registryMutations: false, elevationRequested: false }));
