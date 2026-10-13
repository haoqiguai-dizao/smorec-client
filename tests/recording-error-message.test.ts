import assert from 'node:assert/strict';
import test from 'node:test';
import { recordingErrorMessage } from '../src/services/recording-error-message';

test('device errors keep the device and remedy without exposing IPC or local diagnostics paths', () => {
  const actionable = '麦克风“GO 3S”没有传入音频。请选择其他输入设备。';
  const native = `${actionable}。诊断日志：D:\\private\\project\\capture.log`;
  assert.equal(recordingErrorMessage(new Error(`Error invoking remote method 'recorder:record-start': Error: ${native}`)), actionable);
  assert.equal(recordingErrorMessage(native), actionable);
  assert.equal(recordingErrorMessage('所选麦克风已断开，请重新选择'), '所选麦克风已断开，请重新选择');
  assert.equal(recordingErrorMessage(undefined), '操作失败，请重试');
});
