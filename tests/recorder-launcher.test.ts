import test from 'node:test';
import assert from 'node:assert/strict';
import { launcherBounds, resizeLauncherBounds } from '../electron/services/recorder-launcher/geometry';
import { RECORDER_URL, trustedRecorderSender, trustedRecorderUrl } from '../electron/services/recorder-launcher/validation';
import { FLOATING_BAR_BOTTOM_GAP } from '../electron/services/window-visibility';

test('launcher recording IPC accepts only its exact main frame and document', () => {
  const sender = {}, mainFrame = { url: RECORDER_URL };
  assert.equal(trustedRecorderSender({ sender, senderFrame: mainFrame }, { sender, mainFrame }), true);
  assert.equal(trustedRecorderSender({ sender: {}, senderFrame: mainFrame }, { sender, mainFrame }), false);
  assert.equal(trustedRecorderSender({ sender, senderFrame: { url: RECORDER_URL } }, { sender, mainFrame }), false);
  assert.equal(trustedRecorderSender({ sender, senderFrame: null }, { sender, mainFrame }), false);
  for (const url of ['frameflow://app/index.html', 'frameflow://app/index.html?overlay=camera',
    RECORDER_URL + '&extra=1', RECORDER_URL + '#frame', 'https://app/index.html?overlay=launcher',
    'frameflow://user@app/index.html?overlay=launcher']) assert.equal(trustedRecorderUrl(url), false);
});

test('opening launcher settings preserves the bottom operation bar on a negative-coordinate monitor', () => {
  const area = { x: -1920, y: -60, width: 1920, height: 1040 };
  const collapsed = launcherBounds(area), expanded = resizeLauncherBounds(collapsed, area, true);
  assert.equal(collapsed.height, 96);
  assert.equal(expanded.height, 704);
  assert.equal(expanded.x, collapsed.x);
  assert.equal(expanded.y + expanded.height, collapsed.y + collapsed.height);
  assert.deepEqual(resizeLauncherBounds(expanded, area, false), collapsed);
});

test('launcher and expanded settings remain reachable after a display shrinks', () => {
  const original = launcherBounds({ x: 0, y: 0, width: 1920, height: 1040 });
  const small = { x: 0, y: 0, width: 600, height: 400 };
  assert.deepEqual(resizeLauncherBounds(original, small, true), { x: 0, y: 0, width: 600, height: 400 });
  assert.deepEqual(resizeLauncherBounds({ x: -800, y: -800, width: 660, height: 520 }, small, false),
    { x: 0, y: 0, width: 600, height: 96 });
});

test('compact launcher keeps the recording bar above the taskbar', () => {
  const area = { x: -1920, y: -50, width: 1920, height: 1040 };
  const bounds = launcherBounds(area);
  assert.equal(bounds.width, 1120);
  assert.equal(area.y + area.height - bounds.y - bounds.height, FLOATING_BAR_BOTTOM_GAP);
  assert.equal(FLOATING_BAR_BOTTOM_GAP, 96);
  assert.equal(bounds.x + bounds.width / 2, area.x + area.width / 2);
});
