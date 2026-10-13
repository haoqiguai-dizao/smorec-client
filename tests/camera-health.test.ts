import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraDataHealth, CAMERA_DATA_WAITING, cameraCoverageWarning, cameraFramesStalled, isCameraTransientWarning } from '../electron/services/camera-health';

test('a short camera track entirely before screen start is reported instead of accepted silently', () => {
  const warning = cameraCoverageWarning(0.27, 0.6751552734375, 21.433333333333334);
  assert.match(warning!, /仅覆盖 0.0 秒/);
  assert.match(warning!, /原片仍已保留/);
});

test('coverage accounts for camera offsets and ignores only small frame-rounding gaps', () => {
  assert.equal(cameraCoverageWarning(22.1, 0.675, 21.4333), undefined);
  assert.equal(cameraCoverageWarning(6.1, 0.2, 6), undefined);
  assert.match(cameraCoverageWarning(3, 0, 20)!, /仅覆盖 3.0 秒/);
  assert.match(cameraCoverageWarning(20, -3, 20)!, /仅覆盖 17.0 秒/);
  assert.equal(cameraCoverageWarning(0.27, 0.6), undefined);
});

test('lack of recording data warns once without requiring track ended or canceling the session', () => {
  const health = new CameraDataHealth(1000);
  health.append(1200);
  assert.equal(health.warning(6199), undefined);
  assert.match(health.warning(6200)!, /编码数据.*未刷新/);
  assert.equal(health.warning(12000), undefined);
  assert.equal(health.append(13000), true, 'Data arrival clears only the current waiting state');
  assert.equal(health.append(13100), false);
  assert.equal(health.warning(18000), undefined);
  assert.match(health.warning(18100)!, /编码数据.*未刷新/);
});

test('continued data does not warn even when the camera scene does not change', () => {
  const health = new CameraDataHealth(0);
  for (let now = 250; now < 30000; now += 250) {
    health.append(now);
    assert.equal(health.warning(now + 100), undefined);
  }
});

test('a stalled frame clock reports its own warning while byte-level chunk health stays silent', () => {
  // Reproduces the 2026-09-19 recording: the recorder kept flushing chunks every second for the
  // full 16.97 s, so CameraDataHealth never warned, yet the encoder stopped at 7.64 s. Only the
  // frame clock can see that failure, so it needs its own message.
  const health = new CameraDataHealth(0);
  for (let now = 1000; now <= 17000; now += 1000) {
    health.append(now);
    assert.equal(health.warning(now + 1), undefined, 'chunk arrival alone must never imply live frames');
  }
  assert.match(cameraFramesStalled(7.4), /没有新画面/);
  assert.match(cameraFramesStalled(7.4), /屏幕仍在录制/);
  // The notice never claims less than the monitor's own five-second threshold.
  assert.match(cameraFramesStalled(0.2), /超过 5 秒/);
});

test('transient camera notices are cleared on recovery while real faults are kept', () => {
  assert.equal(isCameraTransientWarning(CAMERA_DATA_WAITING), true);
  assert.equal(isCameraTransientWarning(cameraFramesStalled(12)), true);
  assert.equal(isCameraTransientWarning('摄像头已断开，屏幕录制仍会继续；请重新连接设备后再录制'), false);
  assert.equal(isCameraTransientWarning(cameraCoverageWarning(7.64, 0.09, 16.968317084)!), false);
});
