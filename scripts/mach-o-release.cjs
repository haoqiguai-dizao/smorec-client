const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

// arm64 codesign changes exactly these lengths and the final signature blob.
// Keep every other header/load-command/code/data/import byte in the identity.
function macBinaryContentHash(bytes) {
  const invalid = () => { throw new Error('Invalid signed arm64 Mach-O layout'); };
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x0100000c) invalid();
  const count = bytes.readUInt32LE(16), end = 32 + bytes.readUInt32LE(20);
  if (!count || end > bytes.length || count > (end - 32) / 8) invalid();
  let offset = 32, signature, linkedit;
  for (let index = 0; index < count; index++) {
    if (offset + 8 > end) invalid();
    const type = bytes.readUInt32LE(offset), size = bytes.readUInt32LE(offset + 4);
    if (size < 8 || size % 8 || offset + size > end) invalid();
    if (type === 0x1d) {
      if (signature || size !== 16) invalid();
      signature = { offset, start: bytes.readUInt32LE(offset + 8), size: bytes.readUInt32LE(offset + 12) };
    }
    if (type === 0x19 && size >= 72 && bytes.subarray(offset + 8, offset + 24).toString().replace(/\0+$/, '') === '__LINKEDIT') {
      if (linkedit) invalid(); linkedit = offset;
    }
    offset += size;
  }
  if (offset !== end || !signature || linkedit === undefined || signature.start < end || !signature.size || signature.start + signature.size !== bytes.length) invalid();
  const fileoff = bytes.readBigUInt64LE(linkedit + 40), filesize = bytes.readBigUInt64LE(linkedit + 48);
  const vmsize = bytes.readBigUInt64LE(linkedit + 32);
  const rounded = size => (size + 16383n) / 16384n * 16384n;
  if (fileoff > BigInt(signature.start) || fileoff + filesize !== BigInt(bytes.length) || vmsize !== rounded(filesize)) invalid();
  const canonical = Buffer.from(bytes.subarray(0, signature.start));
  const contentSize = BigInt(signature.start) - fileoff;
  canonical.writeUInt32LE(0, signature.offset + 12);
  canonical.writeBigUInt64LE(contentSize, linkedit + 48);
  canonical.writeBigUInt64LE(rounded(contentSize), linkedit + 32);
  return createHash('sha256').update(canonical).digest('hex');
}

function verifyMacSignedBinary(source, shipped, run = execFileSync) {
  run('/usr/bin/codesign', ['--verify', '--strict', shipped]);
  if (String(run('/usr/bin/lipo', ['-archs', shipped])).trim() !== 'arm64') throw new Error('Packaged runtime must be arm64: ' + shipped);
  const expected = macBinaryContentHash(fs.readFileSync(source));
  if (macBinaryContentHash(fs.readFileSync(shipped)) !== expected) throw new Error('Packaged executable content differs: ' + shipped);
  return expected;
}
module.exports = { macBinaryContentHash, verifyMacSignedBinary };
