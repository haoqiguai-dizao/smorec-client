import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraConstraints, cameraVideoBitrate, configureCameraFormat, validateCameraDimensions, type CameraTrackConstraints } from '../src/services/camera-quality';
import { cameraActualFormat, cameraFormatLabel, cameraFormatNotice, cameraResolutionAvailable } from '../src/services/camera-format';
import { readCameraFormatPreference, saveCameraFormatPreference } from '../src/services/camera-format-preferences';

test('automatic mode keeps device pixels and explicit formats require a real camera mode', () => {
  const native = cameraConstraints('selected').video as CameraTrackConstraints;
  assert.deepEqual(native.resizeMode, { exact: 'none' });
  assert.deepEqual(native.deviceId, { exact: 'selected' });
  const requested = cameraConstraints('selected', { resolution: '2160p', fps: 60 }).video as MediaTrackConstraints;
  assert.deepEqual(requested.width, { exact: 3840 }); assert.deepEqual(requested.height, { exact: 2160 });
  assert.deepEqual(requested.frameRate, { ideal: 60, max: 60 });
});

test('automatic capture caps a 4K-capable device before attaching consumers', async () => {
  const calls: MediaTrackConstraints[] = [];
  let settings = { width: 3840, height: 2160, frameRate: 60 };
  const track = { getCapabilities: () => ({ width: { max: 3840 }, height: { max: 2160 }, frameRate: { max: 60 } }),
    getSettings: () => settings,
    applyConstraints: async (value: MediaTrackConstraints) => { calls.push(value); settings = { width: 1920, height: 1080, frameRate: 30 }; } } as unknown as MediaStreamTrack;
  await configureCameraFormat(track, { resolution: 'auto', fps: 30 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].width, { ideal: 1920, max: 1920 });
  assert.deepEqual(calls[0].height, { ideal: 1080, max: 1080 });
  assert.deepEqual(calls[0].frameRate, { ideal: 30, max: 30 });
  assert.equal(cameraFormatNotice({ resolution: 'auto', fps: 30 }, cameraActualFormat(track)), undefined);
});

test('capability ranges do not promise a resolution/FPS combination; unsupported dimensions are disabled', () => {
  const track = { getCapabilities: () => ({ width: { max: 1920 }, height: { max: 1080 } }) } as unknown as MediaStreamTrack;
  assert.equal(cameraResolutionAvailable('2160p', track), false);
  assert.equal(cameraResolutionAvailable('1080p', track), true);
  assert.equal(cameraResolutionAvailable('auto', track), true);
});

test('actual camera format does not round 29.97 into an invented 60 FPS', () => {
  assert.equal(cameraFormatLabel({ width: 1920, height: 1080, fps: 29.97003 }), '1920 × 1080 · 29.97 FPS');
  assert.equal(cameraFormatNotice({ resolution: '1080p', fps: 30 }, { width: 1920, height: 1080, fps: 29.97 }), undefined);
  assert.match(cameraFormatNotice({ resolution: '2160p', fps: 60 }, { width: 1920, height: 1080, fps: 30 })!, /未达到所选分辨率/);
});

test('device dimensions beyond the 8K pixel budget fail instead of silently shrinking', async () => {
  assert.doesNotThrow(() => validateCameraDimensions({ width: 7680, height: 4320 }));
  assert.throws(() => validateCameraDimensions({ width: 8192, height: 8192 }), /选择较低分辨率/);
  let calls = 0;
  const track = { getCapabilities: () => ({ width: { max: 16384 }, height: { max: 8640 } }),
    getSettings: () => ({ width: 16384, height: 8640 }), applyConstraints: async () => { calls++; } } as unknown as MediaStreamTrack;
  await assert.rejects(configureCameraFormat(track, { resolution: 'auto', fps: 30 }), /超过支持范围/);
  assert.equal(calls, 1, 'reject before attaching a recorder or repeatedly negotiating a huge source');
});

test('archive bitrate retains 4K60 detail independently of a tiny RTC viewport', () => {
  const full = cameraVideoBitrate({ width: 3840, height: 2160, frameRate: 60 });
  assert.equal(full, 64_696_320);
  assert.equal(cameraVideoBitrate({ width: 3840, height: 2160, frameRate: 30 }), full / 2);
  assert.equal(cameraVideoBitrate({ width: 1920, height: 1080, frameRate: 30 }), 8_087_040);
  assert.equal(cameraVideoBitrate({ width: 7680, height: 4320, frameRate: 60 }), 80_000_000);
});

test('format preferences survive restart per device without touching app preferences', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  assert.deepEqual(readCameraFormatPreference('a', storage), { resolution: 'auto', fps: 30 });
  saveCameraFormatPreference('a', { resolution: '2160p', fps: 60 }, storage);
  saveCameraFormatPreference('b', { resolution: '1080p', fps: 30 }, storage);
  assert.deepEqual(readCameraFormatPreference('a', storage), { resolution: '2160p', fps: 60 });
  assert.deepEqual(readCameraFormatPreference('b', storage), { resolution: '1080p', fps: 30 });
  saveCameraFormatPreference('', { resolution: '1440p', fps: 60 }, storage);
  assert.deepEqual(readCameraFormatPreference('default', storage), { resolution: 'auto', fps: 30 });
  assert.deepEqual(readCameraFormatPreference('', storage), { resolution: '1440p', fps: 60 });
});

test('old automatic-by-maximum preferences migrate while explicit quality choices survive', () => {
  const storage = { getItem: () => JSON.stringify({ resolution: 'native', fps: 60 }), setItem: () => {} };
  assert.deepEqual(readCameraFormatPreference('legacy', storage), { resolution: 'auto', fps: 30 });
  const explicit = { ...storage, getItem: () => JSON.stringify({ resolution: '2160p', fps: 60 }) };
  assert.deepEqual(readCameraFormatPreference('explicit', explicit), { resolution: '2160p', fps: 60 });
});

test('automatic capture rejects ignored limits rather than recording a hidden 4K or 60 FPS stream', async () => {
  for (const settings of [{ width: 3840, height: 2160, frameRate: 30 }, { width: 1920, height: 1080, frameRate: 60 }]) {
    const track = { getSettings: () => settings, applyConstraints: async () => {} } as unknown as MediaStreamTrack;
    await assert.rejects(configureCameraFormat(track), /未能采用自动录制规格/);
  }
});

test('automatic frame-rate compatibility keeps the pixel cap and never accepts a faster source', async () => {
  const calls: MediaTrackConstraints[] = [];
  const track = { getSettings: () => ({ width: 1280, height: 720, frameRate: 29.97 }),
    applyConstraints: async (value: MediaTrackConstraints) => {
      calls.push(value);
      if (calls.length === 1) throw Object.assign(new DOMException('rate', 'OverconstrainedError'), { constraint: 'frameRate' });
    } } as unknown as MediaStreamTrack;
  await configureCameraFormat(track);
  assert.deepEqual(calls[1].frameRate, { ideal: 30 });
  assert.deepEqual(calls[1].width, { ideal: 1920, max: 1920 });
});
