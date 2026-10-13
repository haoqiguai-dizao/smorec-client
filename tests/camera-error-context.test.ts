import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraErrorContext } from '../src/services/camera-error-context';

const missing = () => new DOMException('Requested device not found', 'NotFoundError');
test('suspended internal camera is not described as disconnected hardware', async () => {
  assert.match(await cameraErrorContext(missing(), async () => ({ availableCount: 0, suspendedCount: 1, builtInSuspended: true })), /内置摄像头.*暂停.*上盖/);
});
test('an available alternative does not silently replace a missing selected camera', async () => {
  assert.match(await cameraErrorContext(missing(), async () => ({ availableCount: 1, suspendedCount: 1, builtInSuspended: true })), /所选摄像头.*选择其他/);
});
test('external suspension and genuinely absent hardware receive distinct messages', async () => {
  assert.match(await cameraErrorContext(missing(), async () => ({ availableCount: 0, suspendedCount: 1, builtInSuspended: false })), /已连接.*暂停/);
  assert.match(await cameraErrorContext(missing(), async () => ({ availableCount: 0, suspendedCount: 0, builtInSuspended: false })), /未检测到/);
});
test('a denied permission never probes hardware or claims that the camera is missing', async () => {
  assert.match(await cameraErrorContext(new DOMException('Denied', 'NotAllowedError'), async () => assert.fail('must not probe')), /权限未开启/);
});
test('an unavailable status service preserves the original actionable camera error', async () => {
  assert.match(await cameraErrorContext(missing(), async () => { throw new Error('offline'); }), /未检测到/);
});
