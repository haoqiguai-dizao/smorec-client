import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraContainer, cameraHeaderLength, validateCameraChunkHeader } from '../shared/camera-container';
import { cameraRecorderOptions } from '../src/services/camera-recorder-options';

test('container protocol accepts actual H264/MP4 and VP8/WebM with a legacy two-argument default', () => {
  assert.equal(cameraContainer('video/mp4;codecs=avc1.420034').extension, 'mp4');
  assert.equal(cameraContainer('video/mp4; codecs="avc3.640034"').extension, 'mp4');
  assert.equal(cameraContainer('video/webm;codecs=vp8').extension, 'webm');
  assert.equal(cameraContainer(undefined).extension, 'webm');
});

test('unknown or misleading container and codec declarations are rejected', () => {
  for (const mime of ['video/webm;codecs=avc1', 'video/mp4;codecs=vp8', 'video/mp4evil;codecs=avc1',
    'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', '', null, {}, 'video/mp4;codecs="avc1']) {
    assert.throws(() => cameraContainer(mime), /格式/);
  }
});

test('MP4 ftyp and WebM EBML magic remain validated for every possible split of the prefix', () => {
  for (const [mime, bytes] of [
    ['video/mp4;codecs=avc1', new Uint8Array([0, 0, 0, 36, 102, 116, 121, 112])],
    ['video/webm;codecs=vp8', new Uint8Array([26, 69, 223, 163])],
  ] as const) {
    const format = cameraContainer(mime); assert.equal(cameraHeaderLength(format), bytes.length);
    for (let cut = 1; cut < bytes.length; cut++) {
      assert.doesNotThrow(() => validateCameraChunkHeader(format, 0, bytes.subarray(0, cut)));
      assert.doesNotThrow(() => validateCameraChunkHeader(format, cut, bytes.subarray(cut)));
    }
    const corrupted = bytes.slice(); corrupted[bytes.length - 1] ^= 1;
    assert.throws(() => validateCameraChunkHeader(format, bytes.length - 1, corrupted.subarray(bytes.length - 1)), /不匹配/);
  }
});

test('a file cannot declare MP4 while sending a WebM header or vice versa', () => {
  assert.throws(() => validateCameraChunkHeader(cameraContainer('video/mp4;codecs=avc1'), 0,
    new Uint8Array([26, 69, 223, 163, 159, 66, 134, 129])), /不匹配/);
  assert.throws(() => validateCameraChunkHeader(cameraContainer('video/webm;codecs=vp8'), 0,
    new Uint8Array([0, 0, 0, 36, 102, 116, 121, 112])), /不匹配/);
});

test('encoding preference has only tested containers and keeps a VP8 compatibility fallback', () => {
  const format = { width: 3840, height: 2160, frameRate: 60 };
  assert.equal(cameraRecorderOptions(format, () => true).mimeType, 'video/mp4;codecs=avc1');
  assert.equal(cameraRecorderOptions(format, type => type.includes('vp8')).mimeType, 'video/webm;codecs=vp8');
  assert.throws(() => cameraRecorderOptions(format, () => false), /不支持/);
});

test('a 4K camera is never routed to the software VP8 encoder while MP4 is available', () => {
  // Regression: an external 3840x2160 camera on the software VP8 path stopped emitting frames
  // after 7.64 s of a 16.97 s recording. VP8 is software-only on every desktop platform, so the
  // container choice must not depend on whether the device looks like a built-in camera.
  for (const format of [{ width: 3840, height: 2160, frameRate: 30 }, { width: 1552, height: 1552, frameRate: 30 }]) {
    assert.equal(cameraRecorderOptions(format, () => true).mimeType, 'video/mp4;codecs=avc1');
  }
});
