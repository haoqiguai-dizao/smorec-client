import assert from 'node:assert/strict';
import test from 'node:test';
import { exportVideoPayload, exportVideoTransport } from '../electron/services/export-codec';
import type { ExportSettings } from '../shared/types';

const base: ExportSettings = { width: 4608, height: 2592, fps: 60, frames: 10560 };
test('HEVC is muxed once, without a software video encoder, and uses the Apple-compatible hvc1 tag', () => {
  const transport = exportVideoTransport({ ...base, codec: 'hevc' });
  assert.deepEqual(transport.input, ['-f', 'hevc', '-r', '60']);
  assert.deepEqual(transport.output, ['-c:v', 'copy', '-tag:v', 'hvc1']);
  assert.equal(transport.header, undefined);
});
test('H264 direct copy and legacy VP8 IVF format remain compatible', () => {
  assert.deepEqual(exportVideoTransport({ ...base, codec: 'h264' }), {
    input: ['-f', 'h264', '-r', '60'], output: ['-c:v', 'copy'],
  });
  const legacy = exportVideoTransport(base);
  assert.equal(legacy.header?.toString('ascii', 0, 4), 'DKIF');
  assert.equal(legacy.header?.toString('ascii', 8, 12), 'VP80');
  assert.equal(legacy.header?.readUInt16LE(12), 4608);
  assert.equal(legacy.header?.readUInt16LE(14), 2592);
  assert.equal(legacy.header?.readUInt32LE(16), 60);
  assert.equal(legacy.header?.readUInt32LE(24), 10560);
});
test('both Annex B start code lengths strip IPC envelopes; malformed packets fail before writing', () => {
  for (const codec of ['h264', 'hevc'] as const) for (const prefix of [[0, 0, 1], [0, 0, 0, 1]]) {
    const payload = Buffer.from([...prefix, codec === 'hevc' ? 64 : 103, 1, 2, 3]);
    const packet = Buffer.concat([Buffer.alloc(12, 255), payload]);
    assert.deepEqual(exportVideoPayload({ ...base, codec }, packet), payload);
    assert.equal(exportVideoPayload(base, packet), packet);
    assert.throws(() => exportVideoPayload({ ...base, codec }, Buffer.alloc(20)), /视频帧格式无效/);
  }
});
