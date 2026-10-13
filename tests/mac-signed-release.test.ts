import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { macBinaryContentHash, verifyMacSignedBinary } = createRequire(import.meta.url)('../scripts/mach-o-release.cjs');

function image(signatureBytes: number, fill = 51) {
  const bytes = Buffer.alloc(256 + signatureBytes, fill);
  bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 16); bytes.writeUInt32LE(88, 20);
  bytes.writeUInt32LE(0x19, 32); bytes.writeUInt32LE(72, 36);
  bytes.fill(0, 40, 56); bytes.write('__LINKEDIT', 40);
  bytes.writeBigUInt64LE(4096n, 56); bytes.writeBigUInt64LE(BigInt(Math.ceil((128 + signatureBytes) / 16384) * 16384), 64);
  bytes.writeBigUInt64LE(128n, 72); bytes.writeBigUInt64LE(BigInt(128 + signatureBytes), 80);
  bytes.writeUInt32LE(0x1d, 104); bytes.writeUInt32LE(16, 108); bytes.writeUInt32LE(256, 112); bytes.writeUInt32LE(signatureBytes, 116);
  bytes.fill(signatureBytes % 255, 256);
  return bytes;
}
test('Mach-O identity permits only signature bytes and their validated segment lengths to differ', () => {
  assert.equal(macBinaryContentHash(image(20000)), macBinaryContentHash(image(64)));
});
test('Mach-O identity includes executable, data and non-signature load commands', () => {
  const original = image(64);
  for (const offset of [8, 56, 128, 255]) {
    const changed = Buffer.from(original); changed[offset] ^= 1;
    assert.notEqual(macBinaryContentHash(changed), macBinaryContentHash(original));
  }
});
test('Mach-O identity refuses invalid signature extent, segment sizing and extra trailing data', () => {
  const invalid = [Buffer.concat([image(64), Buffer.from([0])]), image(64), image(64), image(64)];
  invalid[1].writeUInt32LE(128, 112); invalid[2].writeBigUInt64LE(1n, 64); invalid[3].writeUInt32LE(0, 108);
  for (const value of invalid) assert.throws(() => macBinaryContentHash(value), /Invalid signed arm64/);
});
test('runtime gate rejects invalid signatures even when normalized content matches', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-signed-gate-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), shipped = path.join(root, 'shipped');
  await fs.writeFile(source, image(20000)); await fs.writeFile(shipped, image(64));
  const run = (command: string) => { assert.equal(command, '/usr/bin/codesign'); throw new Error('invalid signature'); };
  assert.throws(() => verifyMacSignedBinary(source, shipped, run), /invalid signature/);
});
test('runtime gate accepts re-signing but rejects a validly signed changed or older runtime', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-signed-gate-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), shipped = path.join(root, 'shipped');
  const run = (command: string) => command === '/usr/bin/codesign' ? '' : 'arm64';
  await fs.writeFile(source, image(20000)); await fs.writeFile(shipped, image(64));
  assert.equal(verifyMacSignedBinary(source, shipped, run), macBinaryContentHash(image(64)));
  const changed = image(64); changed[255] ^= 1; await fs.writeFile(shipped, changed);
  assert.throws(() => verifyMacSignedBinary(source, shipped, run), /executable content differs/);
  await fs.writeFile(shipped, image(64, 52));
  assert.throws(() => verifyMacSignedBinary(source, shipped, run), /executable content differs/);
});
