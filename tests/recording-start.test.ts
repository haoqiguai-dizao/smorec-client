import assert from 'node:assert/strict';
import test from 'node:test';
import { startRecordingSources } from '../electron/services/recording-start';
import type { NativeClient } from '../electron/services/native-client';

const options = { sourceId: 'screen:1', fps: 60 as const, systemAudio: true, microphone: true, cameraSessionId: 'camera' };
function fixture(failAt?: string) {
  const calls: string[] = [];
  const mark = async (name: string) => { calls.push(name); if (name === failAt) throw Error(name); };
  const native = { request: async (name: string) => { await mark(name); return { startedAtUnixMs: 1234 }; } } as Pick<NativeClient, 'request'>;
  const camera = { start: async () => mark('camera') };
  return { calls, native, camera };
}
test('Mac warms devices, waits for camera encoding, then starts the screen/audio timeline', async () => {
  for (const microphone of [true, false]) {
    const { calls, native, camera } = fixture();
    const result = await startRecordingSources(native, camera, { ...options, microphone }, '/recording', [], 'darwin');
    assert.deepEqual(calls, ['prepare-recording', 'camera', 'begin-recording']);
    assert.equal(result.startedAtUnixMs, 1234);
  }
});
test('failed Mac preparation or camera acknowledgement never commits a screen recording', async () => {
  for (const failAt of ['prepare-recording', 'camera']) {
    const { calls, native, camera } = fixture(failAt);
    await assert.rejects(startRecordingSources(native, camera, options, '/recording', [], 'darwin'), new RegExp(failAt));
    assert.equal(calls.includes('begin-recording'), false);
  }
});
test('screen-only Mac recordings and Windows device startup retain their existing order', async () => {
  const cases = [
    { platform: 'darwin' as const, value: { ...options, cameraSessionId: undefined }, expected: ['start'] },
    { platform: 'win32' as const, value: options, expected: ['start', 'camera'] },
    { platform: 'win32' as const, value: { ...options, microphone: false }, expected: ['camera', 'start'] },
  ];
  for (const { platform, value, expected } of cases) {
    const { calls, native, camera } = fixture();
    await startRecordingSources(native, camera, value, '/recording', [], platform);
    assert.deepEqual(calls, expected);
  }
});
