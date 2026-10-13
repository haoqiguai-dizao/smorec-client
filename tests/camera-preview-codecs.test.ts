import assert from 'node:assert/strict';
import test from 'node:test';
import { preferCameraPreviewCodec } from '../src/services/camera-preview-codecs';

test('H264 preference retains all advertised fallback and repair codecs on either peer', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'RTCRtpReceiver');
  const codecs = [{ mimeType: 'video/VP8', clockRate: 90000 }, { mimeType: 'video/rtx', clockRate: 90000 },
    { mimeType: 'video/H264', clockRate: 90000 }, { mimeType: 'video/red', clockRate: 90000 }];
  Object.defineProperty(globalThis, 'RTCRtpReceiver', { configurable: true, value: { getCapabilities: () => ({ codecs }) } });
  try {
    let chosen: RTCRtpCodec[] = [];
    preferCameraPreviewCodec({ setCodecPreferences: value => { chosen = [...value]; } } as RTCRtpTransceiver);
    assert.equal(chosen[0].mimeType, 'video/H264');
    assert.equal(chosen.length, codecs.length);
    assert.deepEqual(new Set(chosen), new Set(codecs));
    assert.equal(codecs[0].mimeType, 'video/VP8', 'Do not mutate shared capability data');
    assert.doesNotThrow(() => preferCameraPreviewCodec({ setCodecPreferences: () => { throw new Error('Unsupported'); } } as unknown as RTCRtpTransceiver));
  } finally {
    if (before) Object.defineProperty(globalThis, 'RTCRtpReceiver', before);
    else Reflect.deleteProperty(globalThis, 'RTCRtpReceiver');
  }
});
