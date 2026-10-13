import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { preservedRegisters } from './nsis-harness.mjs';

export async function verifyDriveResults(output, cases) {
  const rows = (await fs.readFile(path.join(output, 'drives.tsv'))).toString('utf16le').trimEnd().split(/\r?\n/);
  assert.equal(rows.length, cases.length + 4, 'Every native drive-policy case and both installation defaults must run');
  const expectedRegisters = preservedRegisters.map((_, index) => `preserved-${index}`);
  const checks = cases.map((item, index) => {
    const [name, actual, eligible, stack, ...registers] = rows[index].split('\t');
    assert.equal(name, item.name);
    const expected = item.expected ? `${item.expected}:\\Program Files\\小录` : '';
    assert.equal(actual, expected, `${name}: actual NSIS drive selection`);
    assert.equal(stack, 'preserved-stack', `${name}: selection stack`);
    assert.deepEqual(registers, expectedRegisters, `${name}: selection registers`);
    return { ...item, expected, actual, eligible, registersPreserved: true, stackPreserved: true };
  });
  const [name, selectedPath, windowsDirectory, stack, ...registers] = rows[cases.length].split('\t');
  assert.equal(name, 'live-registers');
  assert.equal(stack, 'preserved-stack', 'Live Win32 probe stack');
  assert.deepEqual(registers, expectedRegisters, 'Live Win32 probe registers');
  const [volumeName, selected, windows, type, available, flags, dType, dAvailable, dFlags] = rows[cases.length + 1].split('\t');
  assert.equal(volumeName, 'live-volume');
  assert.equal(selected, selectedPath);
  assert.equal(windows, windowsDirectory);
  if (selectedPath) {
    assert.match(selectedPath, /^[A-Z]:\\Program Files\\小录$/);
    assert.notEqual(selectedPath[0].toUpperCase(), windowsDirectory[0].toUpperCase(), 'Never prefer the Windows system drive');
    assert.equal(Number(type), 3, 'Selected drive must be fixed');
    assert.notEqual(Number(available), 0, 'Selected volume must be available');
    assert.equal(Number(flags) & 0x80000, 0, 'Selected volume must not be read-only');
  }
  if (windowsDirectory[0].toUpperCase() !== 'D' && Number(dType) === 3 && Number(dAvailable) !== 0 && !(Number(dFlags) & 0x80000)) {
    assert.equal(selectedPath, 'D:\\Program Files\\小录', 'Prefer the independently probed eligible D drive on this host');
  }
  const [integrationName, appliedPath, fallbackPath, integrationStack, ...integrationRegisters] = rows[cases.length + 2].split('\t');
  assert.equal(integrationName, 'live-default-integration');
  assert.equal(appliedPath, selectedPath || fallbackPath, 'Production default macro must apply the actual preferred drive or preserve fallback');
  assert.equal(integrationStack, 'preserved-stack', 'Production default macro stack');
  assert.deepEqual(integrationRegisters, expectedRegisters, 'Production default macro must preserve R0 and every other register');
  const [userName, userPath, userFallback] = rows[cases.length + 3].split('\t');
  assert.equal(userName, 'current-user-default');
  assert.equal(userPath, userFallback, 'Fresh current-user installs must retain their user-writable Programs directory');
  return { checks, defaultIntegration: { macro: 'SmoRecApplyPreferredDefault', fallbackPath, appliedPath, registersPreserved: true, stackPreserved: true },
    liveProbe: { selectedPath, windowsDirectory, driveType: Number(type), volumeAvailable: Number(available), volumeFlags: Number(flags),
    dDrive: { type: Number(dType), available: Number(dAvailable), flags: Number(dFlags) }, registersPreserved: true, stackPreserved: true, readOnlyProbe: true } };
}
