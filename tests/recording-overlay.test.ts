import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOverlayControl, parsePreviewSignal, trustedOverlaySender, trustedOverlayUrl } from '../electron/services/recording-overlay/validation';
import { cameraOverlayBounds, cameraOverlayCenter, clampOverlayBounds, toolbarOverlayBounds } from '../electron/services/recording-overlay/geometry';

const sessionId = 'c6e224bc-551e-4b04-93d8-6b0c755d504e';
test('overlay IPC requires the exact webContents, main frame and role URL', () => {
  const sender = {}, mainFrame = { url: 'frameflow://app/index.html?overlay=camera' }, owner = { sender, mainFrame };
  assert.equal(trustedOverlaySender({ sender, senderFrame: mainFrame }, owner, 'camera'), true);
  assert.equal(trustedOverlaySender({ sender, senderFrame: { ...mainFrame } }, owner, 'camera'), false);
  assert.equal(trustedOverlaySender({ sender: {}, senderFrame: mainFrame }, owner, 'camera'), false);
  assert.equal(trustedOverlaySender({ sender, senderFrame: null }, owner, 'camera'), false);
  assert.equal(trustedOverlaySender({ sender, senderFrame: mainFrame }, owner, 'toolbar'), false);
  for (const url of ['https://app/index.html?overlay=camera', 'frameflow://app/index.html',
    'frameflow://app/index.html?overlay=camera&overlay=toolbar', 'frameflow://other/index.html?overlay=camera',
    'frameflow://app/index.html?overlay=camera#other', 'frameflow://user@app/index.html?overlay=camera']) {
    assert.equal(trustedOverlayUrl(url, 'camera'), false, url);
  }
});
test('controls accept only explicit booleans, supported shapes and finite camera sizes', () => {
  assert.deepEqual(parseOverlayControl({ type: 'stop', path: 'ignored' }), { type: 'stop' });
  assert.deepEqual(parseOverlayControl({ type: 'microphone-muted', value: true }), { type: 'microphone-muted', value: true });
  assert.deepEqual(parseOverlayControl({ type: 'camera-shape', value: 'rounded' }), { type: 'camera-shape', value: 'rounded' });
  for (const value of [null, [], { type: 'open-file' }, { type: 'camera-visible', value: 1 },
    { type: 'camera-shape', value: 'triangle' }, ...[NaN, Infinity, .119, .421].map(value => ({ type: 'camera-size', value }))]) {
    assert.throws(() => parseOverlayControl(value));
  }
});
test('preview signaling is session bound, directional, normalized and limited by UTF-8 size', () => {
  const offer = { sessionId, signal: { type: 'offer', sdp: 'v=0\r\n' }, ignored: 'not forwarded' };
  assert.deepEqual(parsePreviewSignal(offer, sessionId, 'host'), { sessionId, signal: { type: 'offer', sdp: 'v=0\r\n' } });
  assert.throws(() => parsePreviewSignal(offer, sessionId, 'camera'), /方向/);
  assert.throws(() => parsePreviewSignal(offer, '20ca5423-b8df-4c9e-b6a3-99f888279093', 'host'), /过期/);
  assert.throws(() => parsePreviewSignal({ sessionId, signal: { type: 'offer', sdp: '字'.repeat(22000) } }, sessionId, 'host'), /64KB/);
  assert.throws(() => parsePreviewSignal({ ...offer, extra: 'x'.repeat(65536) }, sessionId, 'host'), /64KB/);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.throws(() => parsePreviewSignal(cycle, sessionId, 'host'), /序列化/);
  assert.throws(() => parsePreviewSignal({ sessionId, signal: { type: 'candidate', candidate: { candidate: '', sdpMLineIndex: NaN } } }, sessionId, 'camera'));
  const candidate = { candidate: 'candidate:1 1 UDP 1 127.0.0.1 1234 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null };
  assert.deepEqual(parsePreviewSignal({ sessionId, signal: { type: 'candidate', candidate: { ...candidate, path: 'ignored' } } }, sessionId, 'camera'),
    { sessionId, signal: { type: 'candidate', candidate } });
});
test('camera sizes include six pixel shadows and preserve their normalized center inside a display', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1000 }, center = { x: .85, y: .8 };
  const circle = cameraOverlayBounds(area, .22, center, 'circle');
  const rounded = cameraOverlayBounds(area, .22, center, 'rounded');
  assert.equal(circle.width, 232); assert.equal(circle.height, 232);
  assert.equal(rounded.width, 232); assert.equal(rounded.height, 188);
  assert.deepEqual(cameraOverlayCenter(circle, area), center);
  assert.deepEqual(clampOverlayBounds({ x: 100, y: 1200, width: 232, height: 232 }, area),
    { x: -232, y: 768, width: 232, height: 232 });
});
test('toolbar settings grow upward while keeping the same display and bottom edge', () => {
  const area = { x: 1920, y: 0, width: 1280, height: 720 };
  const small = toolbarOverlayBounds(area, false), expanded = toolbarOverlayBounds(area, true);
  assert.equal(small.width, 466); assert.equal(small.height, 78); assert.equal(expanded.height, 420);
  assert.equal(small.y + small.height, expanded.y + expanded.height); assert.equal(small.x, expanded.x);
});
