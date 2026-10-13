import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraConnectionCanceled, CameraConnectionCanceledError, cameraError } from '../src/services/camera-errors';

test('native driver AbortError remains visible while app cancellation is silent', () => {
  const native = new DOMException('Timeout starting video source', 'AbortError');
  assert.equal(cameraConnectionCanceled(native), false);
  assert.match(cameraError(native), /已识别.*启动失败/);
  assert.equal(cameraConnectionCanceled(new CameraConnectionCanceledError()), true);
  assert.match(cameraError(new DOMException('busy', 'NotReadableError')), /占用/);
  assert.match(cameraError(new DOMException('denied', 'NotAllowedError')), /权限/);
});
