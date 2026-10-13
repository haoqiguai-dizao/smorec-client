import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './fixtures/whiteboard-window';
import type { BoardSnapshot } from '../shared/whiteboard/types';
import type { LiveRecordingState } from '../shared/types';

test('a selected camera board is the first revealed frame and switching modes preserves this board', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher');
  f.board.updateCamera({ status: 'recording', cameraSessionId: 'camera', cameraAvailable: true, cameraVisible: true } as LiveRecordingState);
  await f.selectMode('camera');
  assert.equal(f.resets.length, 1);
  assert.equal(f.windows[0].reveals[0].backdrop, 'camera');
  assert.deepEqual(f.windows[0].reveals[0].cameraTransition?.camera, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(f.windows[0].reveals[0].windowOptions?.transparent, false);
  await f.request('action', 'first', { kind: 'text', id: 'ink', color: '#20242c', size: 32, x: 20, y: 20, text: '本次内容' });
  await f.selectMode('interface');
  const snapshot = f.request('snapshot') as BoardSnapshot;
  assert.equal(snapshot.backdrop, 'white'); assert.equal(snapshot.presentation, 'interface');
  assert.equal(snapshot.windowOptions?.transparent, false);
  assert.deepEqual(f.syncs.at(-1), { mode: 'interface', visible: true });
  await f.selectMode('canvas');
  assert.equal(f.resets.length, 1); assert.equal(f.events.filter(action => action.kind === 'text').length, 1);
  await f.board.setVisible(false); await f.selectMode('interface');
  assert.equal(f.resets.length, 2); f.board.dispose();
});

test('mode cancellation or an unavailable camera leaves the hidden board untouched', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher');
  await f.selectMode(); await f.selectMode('camera');
  assert.equal(f.windows[0].shown, false); assert.equal(f.resets.length, 0); f.board.dispose();
});

test('only this board renderer and this opening token can reveal the prepared frame', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher');
  f.windows[0].autoReady = false;
  const opening = f.selectMode('interface');
  await new Promise(resolve => setImmediate(resolve));
  const snapshot = f.request('snapshot') as BoardSnapshot;
  assert.ok(snapshot.opening); assert.equal(f.windows[0].shown, false);
  await f.request('view-ready', 'old-session', snapshot.opening);
  await f.request('view-ready', snapshot.session, 'old-opening');
  // The valid toolbar can request a mode but cannot acknowledge the board's paint.
  await f.toolbarRequest('view-ready', snapshot.session, snapshot.opening);
  assert.equal(f.windows[0].shown, false);
  await f.request('view-ready', snapshot.session, snapshot.opening); await opening;
  assert.equal(f.windows[0].shown, true);
  assert.equal(f.windows[0].reveals[0].presentation, 'interface');
  assert.equal(f.windows[0].reveals[0].windowOptions?.transparent, false);
  assert.deepEqual(f.syncs.at(-1), { mode: 'interface', visible: true }); f.board.dispose();
});

test('local transparency survives output mode switches and is not an output mode', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher');
  await f.request('window-options', 'first', { transparent: true });
  await f.selectMode('canvas');
  assert.equal(f.windows[0].reveals[0].presentation, 'canvas');
  await f.request('action', 'first', { kind: 'text', id: 'ink', color: '#20242c', size: 32, x: 20, y: 20, text: '内容' });
  await f.selectMode('interface'); await f.selectMode('canvas');
  const state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.windowOptions?.transparent, true); assert.equal(state.presentation, 'canvas');
  assert.equal(f.resets.length, 1); assert.equal(f.events.filter(action => action.kind === 'text').length, 1);
  f.presentation.supported = false;
  await f.selectMode('interface');
  assert.equal((f.request('snapshot') as BoardSnapshot).presentation, 'canvas'); f.board.dispose();
});

test('camera tracing transparency changes the local window without changing the recorded camera scene', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher');
  f.board.updateCamera({ status: 'recording', cameraSessionId: 'camera', cameraAvailable: true, cameraVisible: true } as LiveRecordingState);
  await f.selectMode('camera');
  const recorded = structuredClone(f.events);
  await f.request('window-options', 'first', { transparent: true, transparency: .6 });
  const state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.backdrop, 'camera'); assert.equal(state.shade, .4);
  assert.equal(state.windowOptions?.transparency, .6); assert.equal(f.windows[0].background, '#00000000');
  assert.deepEqual(f.events, recorded);
  await f.request('window-options', 'first', { transparent: false });
  assert.equal((f.request('snapshot') as BoardSnapshot).backdrop, 'camera');
  assert.deepEqual(f.events, recorded); f.board.dispose();
});
