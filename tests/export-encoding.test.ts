import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseExportEncoding } from '../src/services/export-encoding';
import { exportSettings } from '../electron/services/validation';

test('Mac and Windows select supported Annex B H264 without changing dimensions', async () => {
  const probe = async (config: VideoEncoderConfig) => ({ supported: true, config });
  const mac = await chooseExportEncoding(3420, 2214, 30, 'darwin', probe);
  assert.equal(mac.codec, 'h264');
  assert.equal(mac.config.hardwareAcceleration, 'prefer-hardware');
  assert.equal(mac.config.avc?.format, 'annexb');
  assert.equal(mac.config.width, 3420);
  const windows = await chooseExportEncoding(3420, 2214, 30, 'win32', probe);
  assert.equal(windows.codec, 'h264');
  assert.equal(windows.config.hardwareAcceleration, 'prefer-hardware');
  assert.equal(windows.config.avc?.format, 'annexb');
});
test('unsupported or failed hardware probes fall back without reducing resolution on both platforms', async () => {
  for (const platform of ['darwin', 'win32']) for (const fail of [false, true]) {
    const selected = await chooseExportEncoding(3420, 2214, 30, platform, async config => {
      if (fail && config.codec.startsWith('avc')) throw new Error('unavailable');
      return { config, supported: config.codec === 'vp8' };
    });
    assert.equal(selected.codec, 'vp8'); assert.equal(selected.config.width, 3420);
  }
});
test('export transport accepts only explicit supported codecs and preserves legacy defaults', () => {
  const base = { width: 1920, height: 1080, fps: 30, frames: 30 };
  assert.deepEqual(exportSettings(base), base);
  assert.equal(exportSettings({ ...base, codec: 'h264' }).codec, 'h264');
  assert.equal(exportSettings({ ...base, codec: 'hevc' }).codec, 'hevc');
  assert.throws(() => exportSettings({ ...base, codec: 'av1' }));
});

test('Mac preserves 4608x2592 at 60 FPS by trying Annex B HEVC before software VP8', async () => {
  const probed: VideoEncoderConfig[] = [];
  const selected = await chooseExportEncoding(4608, 2592, 60, 'darwin', async config => {
    probed.push(config); return { config, supported: config.codec.startsWith('hvc1') };
  });
  assert.equal(selected.codec, 'hevc');
  assert.equal(selected.config.width, 4608); assert.equal(selected.config.height, 2592);
  assert.equal(selected.config.framerate, 60); assert.equal(selected.config.hevc?.format, 'annexb');
  assert.equal(selected.hardware, true); assert.equal(probed.length, 2);
  assert.ok(probed[0].codec.startsWith('avc1'));
  assert.ok(!probed.some(config => config.codec === 'vp8'));
});

test('an ignored HEVC bitstream-format option cannot enter the Annex B transport', async () => {
  const selected = await chooseExportEncoding(4608, 2592, 60, 'darwin', async config => ({
    supported: !config.codec.startsWith('avc'), config: { codec: config.codec, width: 4608, height: 2592 },
  }));
  assert.equal(selected.codec, 'vp8'); assert.equal(selected.hardware, false);
});

test('Windows retains the H264/software fallback without introducing an HEVC compatibility change', async () => {
  const codecs: string[] = [];
  await chooseExportEncoding(4608, 2592, 60, 'win32', async config => {
    codecs.push(config.codec); return { config, supported: config.codec === 'vp8' };
  });
  assert.deepEqual(codecs, ['avc1.64003e', 'vp8']);
});
