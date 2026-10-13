// Compile and run the shipping NSIS path macro without installing or touching app data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { directoryCases } from './installer-verification/cases.mjs';
import { makeHarness, preservedRegisters } from './installer-verification/nsis-harness.mjs';
import { driveCases } from './installer-verification/drive-cases.mjs';
import { driveDeclarations, makeDriveChecks } from './installer-verification/drive-harness.mjs';
import { verifyDriveResults } from './installer-verification/verify-drive-results.mjs';
import { createInstallerProcessRunner } from './installer-verification/process-runner.mjs';

const require = createRequire(import.meta.url);
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows.js');
const root = process.cwd();
const { runCompiler, runExecutable } = createInstallerProcessRunner({ cwd: root });
assert.equal(process.platform, 'win32', 'Execute this native NSIS regression on Windows');
const packageInfo = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const versionDirectory = String(packageInfo.version).replace(/[^a-zA-Z0-9-]/g, '');
assert.ok(versionDirectory, 'Package version is required for versioned verification evidence');
const base = path.resolve(root, 'output', `installer-verification-${versionDirectory}`);
const output = path.join(base, new Date().toISOString().replaceAll(/[:.]/g, '-'));
await fs.mkdir(output, { recursive: true });
const include = path.join(root, 'build', 'nsis', 'install-directory.nsh');
const driveInclude = path.join(root, 'build', 'nsis', 'preferred-drive.nsh');
const executable = path.join(output, 'installer-directory-qa.exe');
const script = path.join(output, 'installer-directory-qa.nsi');
const sha256 = content => createHash('sha256').update(content).digest('hex');
const checks = [];
const report = {
  version: packageInfo.version,
  output,
  isolation: 'Only writes this verification directory; no product installation, app shutdown, registry access, or user data access.',
  checks,
};

// Case-insensitive absolute Windows path equality; a terminal slash is equivalent.
function comparable(value) {
  return path.win32.normalize(value).replace(/\\+$/, '').toLowerCase();
}

function extractDefaultMacro(source) {
  const definitions = [...source.matchAll(/^[ \t]*!macro[ \t]+SmoRecApplyPreferredDefault\b[^\r\n]*/gmi)];
  assert.equal(definitions.length, 1, 'Production default macro must be defined exactly once');
  const definition = definitions[0];
  assert.equal(definition[0].trim(), '!macro SmoRecApplyPreferredDefault', 'Review any changed default macro signature');
  const body = source.slice(definition.index);
  const ending = /^[ \t]*!macroend\b[^\r\n]*/mi.exec(body);
  assert.ok(ending, 'Production default macro must have a closing macroend');
  assert.ok(!/^[ \t]*!macro\b/mi.test(body.slice(definition[0].length, ending.index)), 'Nested macro definitions require review');
  return body.slice(0, ending.index + ending[0].length);
}

try {
  const macro = await fs.readFile(include);
  report.macro = { file: include, sha256: sha256(macro) };
  report.preferredDriveMacro = { file: driveInclude, sha256: sha256(await fs.readFile(driveInclude)) };
  const installModesFile = path.join(root, 'build', 'nsis', 'install-modes.nsh');
  const defaultMacro = extractDefaultMacro(await fs.readFile(installModesFile, 'utf8'));
  report.defaultIntegrationMacro = { file: installModesFile, macro: 'SmoRecApplyPreferredDefault', sha256: sha256(defaultMacro) };
  await fs.writeFile(script, `\uFEFF${makeHarness({ include, executable, cases: directoryCases, driveInclude,
    driveDeclarations: [defaultMacro, ...driveDeclarations], driveChecks: makeDriveChecks(driveCases) })}`, 'utf8');
  const compiler = await getMakeNsisPath(packageInfo.build.toolsets?.nsis, packageInfo.build.nsis.customNsisBinary);
  report.compiler = compiler.path;
  const compiled = await runCompiler(compiler.path, ['/V3', '/INPUTCHARSET', 'UTF8', script], compiler.env);
  await fs.writeFile(path.join(output, 'compile.log'), `${compiled.stdout}\n${compiled.stderr}`);
  assert.equal(compiled.code, 0, `NSIS compile failed:\n${compiled.stdout}\n${compiled.stderr}`);
  report.executableSha256 = sha256(await fs.readFile(executable));
  const execution = await runExecutable(executable, ['/S']);
  report.executionExitCode = execution.code;
  assert.equal(execution.code, 0, `Compiled NSIS regression failed: ${execution.stderr}`);
  const rows = (await fs.readFile(path.join(output, 'actual.tsv'))).toString('utf16le').trimEnd().split(/\r?\n/);
  assert.equal(rows.length, directoryCases.length, 'Compiled macro must execute every scenario');
  for (const [index, item] of directoryCases.entries()) {
    const [name, actual, previous, explicit, stack, errorFlag, original, stringLimit, ...registers] = rows[index].split('\t');
    assert.equal(name, item.name, 'Results must be emitted by the expected native scenario');
    assert.equal(errorFlag, String(item.expectedError ?? false), `${name}: native NSIS error flag`);
    if (item.appendOverflow) {
      assert.equal(original.length, Number(stringLimit) - 2, 'Overflow input must reach the compiled NSIS string limit');
      assert.equal(actual, original, 'Overflow must preserve the complete original destination');
    } else {
      assert.equal(comparable(actual), comparable(item.expected), `${name}: normalized installation directory`);
    }
    assert.equal(previous, item.previous ?? '', `${name}: previous installation argument must be preserved`);
    assert.equal(explicit, item.explicit ?? '', `${name}: explicit directory argument must be preserved`);
    assert.equal(stack, 'preserved-stack', `${name}: macro must leave its caller's stack intact`);
    const expectedRegisters = preservedRegisters.map((_, index) => `preserved-${index}`);
    if (item.registerArguments) {
      expectedRegisters[10] = item.previous ?? '';
      expectedRegisters[11] = item.explicit ?? '';
    }
    assert.deepEqual(registers, expectedRegisters, `${name}: macro must preserve registers`);
    checks.push({ name, target: item.target ?? original, previous, explicit, expected: item.expected ?? original, actual,
      errorFlag: errorFlag === 'true', stringLimit: Number(stringLimit), registersPreserved: true, stackPreserved: true });
  }
  report.preferredDrives = await verifyDriveResults(output, driveCases);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.status}: ${checks.length}/${directoryCases.length} native NSIS path scenarios; ${path.join(output, 'report.json')}`);
  if (report.preferredDrives) console.log(`PASS: ${driveCases.length} native drive configurations; read-only live probe selected ${report.preferredDrives.liveProbe.selectedPath || 'upstream fallback'}`);
  if (report.error) console.error(report.error);
}
