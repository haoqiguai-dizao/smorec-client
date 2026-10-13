import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './fixtures/whiteboard-window';
import type { LiveRecordingState } from '../shared/types';
import type { BoardSnapshot } from '../shared/whiteboard/types';


test('adjusting local alpha and toggling demo preserves interface, content and fullscreen settings', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher');
  await f.board.setVisible(true); await f.choose('interface');
  await f.request('window-options', 'first', { pinned: true, transparent: true, transparency: .5 });
  await f.request('maximized', 'first', true);
  f.board.setDemoVisibility(true);
  let state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.demoVisible, true); assert.equal(state.presentation, 'interface');
  assert.equal(state.windowOptions?.transparency, .5); assert.equal(state.maximized, true);
  f.board.setDemoVisibility(false); await f.request('window-options', 'first', { transparency: .8 });
  await f.board.setVisible(false); await f.board.setVisible(true);
  state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.demoVisible, false); assert.equal(state.presentation, 'interface');
  assert.equal(state.windowOptions?.transparency, .8); assert.equal(state.windowOptions?.pinned, true);
  assert.equal(state.maximized, true);
});

test('unified launcher can control the whiteboard only from its owned exact main frame', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher');
  const sender = f.toolbar!.webContents, senderFrame = sender.mainFrame;
  assert.ok(f.invoke({ sender, senderFrame }));
  assert.throws(() => f.invoke({ sender: {}, senderFrame }), /来源/);
  assert.throws(() => f.invoke({ sender, senderFrame: { ...senderFrame } }), /来源/);
  senderFrame.url += '&extra=1';
  assert.throws(() => f.invoke({ sender, senderFrame }), /来源/);
  f.board.dispose();
});

test('recording idle notifications from live camera edits cannot close the live-owned board', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher');
  await f.board.prepare({ id: 'screen:1', kind: 'screen', name: 'live', width: 1920, height: 1080 },
    { sourceId: 'screen:1', fps: 30, microphone: false, systemAudio: false }, 'live');
  f.board.update({ status: 'recording' }, 'live');
  await f.board.setVisible(true);
  f.board.update({ status: 'idle' });
  const snapshot = f.request('snapshot') as BoardSnapshot;
  assert.equal(snapshot.available, true); assert.equal(snapshot.visible, true);
  f.board.update({ status: 'idle' }, 'live');
  assert.equal((f.request('snapshot') as BoardSnapshot).available, true); assert.equal(f.windows[0].shown, false);
  await assert.rejects(Promise.resolve(f.request('action', 'first', { kind: 'clear' })), /不可书写/);
});

test('interface mode selected before the first open survives closing and a second recording', async () => {
  const f = await fixture();
  f.presentation.mode = 'interface';
  await f.board.setVisible(true);
  assert.equal(f.windows[0].shown, true);
  await f.board.setVisible(false);
  await f.board.setVisible(true);
  assert.equal(f.windows[0].shown, true);
  f.board.update({ status: 'idle' });
  f.journal.session = 'second';
  await f.prepare(); f.presentation.mode = 'interface';
  await f.board.setVisible(true);
  assert.equal(f.windows.length, 1);
  assert.equal(f.windows[0].shown, true);
  assert.equal(f.windows[0].loaded, 2);
});

test('click-through reopening restores writable input while retaining transparent and pin choices', async () => {
  const f = await fixture(); await f.board.setVisible(true);
  assert.equal(f.windows[0].pinned, false);
  await f.request('window-options', 'first', { transparent: true, pinned: true, passthrough: true });
  assert.equal(f.windows[0].passthrough, true);
  assert.equal(f.windows[0].background, '#00000000');
  assert.ok(f.events.some(event => event.kind === 'layout' && event.passthrough));
  await f.board.setVisible(false); await f.board.setVisible(true);
  assert.equal(f.windows[0].passthrough, false); assert.equal(f.windows[0].pinned, true);
  assert.equal(f.windows[0].background, '#00000000');
});

test('Windows whiteboard remains natively non-opaque through maximize and restore without disabling drawing', async () => {
  if (process.platform !== 'win32') return;
  const f = await fixture(); await f.board.setVisible(true);
  await f.request('window-options', 'first', { transparent: true });
  assert.equal(f.windows[0].opacity, 254 / 255);
  await f.request('maximized', 'first', true);
  assert.equal(f.windows[0].opacity, 254 / 255); assert.equal(f.windows[0].passthrough, false);
  await f.request('maximized', 'first', false);
  assert.equal(f.windows[0].opacity, 254 / 255);
});

test('transparent fullscreen interface retains capture inclusion and its recorded mode through reopen and restore', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher');
  await f.board.setVisible(true); await f.choose('interface');
  const before = f.syncs.length;
  await f.request('window-options', 'first', { transparent: true });
  await f.request('maximized', 'first', true);
  let state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.presentation, 'interface'); assert.equal(state.maximized, true);
  assert.equal(state.windowOptions?.transparent, true); assert.equal(f.windows[0].background, '#00000000');
  assert.equal(f.syncs.length, before, 'Window appearance must not remove the board from capture');
  await f.board.setVisible(false); await f.board.setVisible(true);
  await f.request('maximized', 'first', false);
  await f.request('window-options', 'first', { transparent: false });
  state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.presentation, 'interface'); assert.equal(state.maximized, false);
  assert.equal(state.windowOptions?.transparent, false);
  const layouts = f.events.filter(event => event.kind === 'layout');
  assert.ok(layouts.slice(1).every(event => event.presentation === 'interface'));
  assert.deepEqual(f.syncs.slice(before), [{ mode: 'interface', visible: false }, { mode: 'interface', visible: true }]);
  f.board.dispose();
});

test('selecting interface after transparency and fullscreen preserves both appearance choices', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher'); await f.board.setVisible(true);
  await f.request('window-options', 'first', { transparent: true });
  await f.request('maximized', 'first', true); await f.choose('interface');
  const state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.presentation, 'interface'); assert.equal(state.maximized, true);
  assert.equal(state.windowOptions?.transparent, true); assert.equal(f.windows[0].background, '#00000000');
  assert.equal(f.events.at(-1)?.kind, 'layout');
  assert.deepEqual(f.syncs.at(-1), { mode: 'interface', visible: true });
  await f.choose('canvas');
  assert.equal((f.request('snapshot') as BoardSnapshot).windowOptions?.transparent, true);
  assert.deepEqual(f.syncs.at(-1), { mode: 'canvas', visible: true });
  f.board.dispose();
});

test('live interface rejects unsupported local transparency without replacing either user choice', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher');
  await f.board.prepare({ id: 'screen:1', kind: 'screen', name: 'live', width: 1920, height: 1080 },
    { sourceId: 'screen:1', fps: 30, microphone: false, systemAudio: false }, 'live');
  f.board.update({ status: 'recording' }, 'live');
  await f.board.setVisible(true); await f.choose('interface');
  const before = f.syncs.length;
  await assert.rejects(Promise.resolve(f.request('window-options', 'first', { transparent: true })), /不支持本地透明/);
  let state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.presentation, 'interface'); assert.equal(state.windowOptions?.transparent, false);
  assert.equal(f.syncs.length, before); assert.equal(f.windows[0].background, '#ffffff');
  await f.choose('canvas'); await f.request('window-options', 'first', { transparent: true });
  await assert.rejects(Promise.resolve(f.choose('interface')), /不支持本地透明/);
  state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.presentation, 'canvas'); assert.equal(state.windowOptions?.transparent, true);
  assert.equal(state.presentationBusy, false); assert.equal(f.windows[0].background, '#00000000');
  f.board.dispose();
});

test('Mac window recording preserves local transparency when interface is chosen', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher'); await f.prepare('window');
  await f.board.setVisible(true); await f.request('window-options', 'first', { transparent: true }); await f.choose('interface');
  const state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.presentation, 'interface'); assert.equal(state.windowOptions?.transparent, true);
  assert.equal(state.interfaceTransparencySupported, true); f.board.dispose();
});

test('window controls reject stale sessions and invalid options without changing window input', async () => {
  const f = await fixture(); await f.board.setVisible(true);
  await assert.rejects(Promise.resolve(f.request('window-options', 'old', { passthrough: true })), /会话已失效/);
  await assert.rejects(Promise.resolve(f.request('window-options', 'first', { passthrough: 'true' })), /设置无效/);
  await assert.rejects(Promise.resolve(f.request('window-options', 'first', { unexpected: true })), /设置无效/);
  assert.equal(f.windows[0].passthrough, false);
});

test('failed capture inclusion is logged, hides the window and allows the next opening', async () => {
  const f = await fixture(); f.presentation.mode = 'interface';
  f.include(async () => { throw new Error('白板窗口尚未就绪'); });
  await assert.rejects(f.board.setVisible(true), /尚未就绪/);
  assert.equal(f.windows[0].shown, false);
  assert.equal(f.events.length, 0);
  assert.equal(f.diagnostics[0][0], 'whiteboard.visibility-failed');
  f.include(async () => {});
  await f.board.setVisible(true);
  assert.equal(f.windows[0].shown, true);
});

test('stopping during capture inclusion does not show a late whiteboard', async () => {
  const f = await fixture(); f.presentation.mode = 'interface';
  let ready!: () => void;
  f.include(() => new Promise<void>(resolve => { ready = resolve; }));
  const opening = f.board.setVisible(true);
  await new Promise(resolve => setImmediate(resolve));
  f.board.update({ status: 'stopping' }); ready(); await opening;
  assert.equal(f.windows[0].shown, false);
  assert.equal(f.events.length, 0);
});

test('a crashed renderer finishes reloading before capture inclusion', async () => {
  const f = await fixture(); f.presentation.mode = 'interface'; f.windows[0].crashed = true;
  let loaded!: () => void, included = false;
  f.windows[0].beforeLoad = () => new Promise<void>(resolve => { loaded = resolve; });
  f.include(async () => { included = true; });
  const opening = f.board.setVisible(true);
  assert.equal(included, false);
  loaded(); await opening;
  assert.equal(included, true);
  assert.equal(f.windows[0].shown, true);
});

test('idle whiteboard opens without starting native capture and preserves its mode, transparency and maximized placement into recording', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher', true);
  assert.equal(f.windows.length, 0);
  await f.board.setVisible(true);
  assert.equal(f.previews.length, 1); assert.equal(f.windows[0].shown, true);
  assert.equal(f.syncs.length, 0, 'Preparation never calls the native recording presentation API');
  await f.choose('interface');
  await f.request('window-options', 'draft', { transparent: true, transparency: .6 });
  await f.request('maximized', 'draft', true);
  await f.board.setVisible(false); await f.board.setVisible(true);
  assert.equal(f.previews.length, 1); assert.equal(f.syncs.length, 0);
  f.board.update({ status: 'starting' });
  assert.equal(f.windows[0].shown, false);
  f.journal.session = 'capture'; await f.prepare();
  await new Promise(resolve => setImmediate(resolve));
  const state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.presentation, 'interface'); assert.equal(state.visible, true);
  assert.equal(state.maximized, true); assert.equal(state.windowOptions?.transparency, .6);
  assert.ok(f.events.some(event => event.kind === 'layout' && event.visible && event.presentation === 'interface'));
  assert.deepEqual(f.syncs.at(-1), { mode: 'interface', visible: true });
  f.board.dispose();
});

test('opening the board after a completed recording starts an independent preparation session', async () => {
  const f = await fixture(); await f.board.setVisible(true);
  f.board.update({ status: 'idle' }); await f.board.setVisible(true);
  assert.equal(f.journal.session, 'draft'); assert.equal(f.previews.length, 1);
  assert.equal(f.windows[0].loaded, 2);
  const before = f.syncs.length;
  await f.board.setVisible(false); await f.board.setVisible(true);
  assert.equal(f.syncs.length, before); f.board.dispose();
});

test('starting during draft loading freezes the preparation and restores the requested board only after capture is ready', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher', true);
  let loaded!: () => void;
  const startPreview = f.journal.startPreview;
  f.journal.startPreview = async directory => {
    await new Promise<void>(resolve => { loaded = resolve; }); await startPreview(directory);
  };
  const opening = f.board.setVisible(true);
  f.board.update({ status: 'starting' }); loaded();
  await assert.rejects(opening, /正在准备/);
  assert.equal(f.windows.length, 0); assert.equal(f.syncs.length, 0);
  f.journal.session = 'capture'; await f.prepare();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.windows[0].shown, true);
  f.board.dispose();
});

test('failed idle preparation remains retryable without requiring a recording or restarting the application', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher', true);
  const startPreview = f.journal.startPreview;
  f.journal.startPreview = async () => { throw new Error('temporary write error'); };
  await assert.rejects(f.board.setVisible(true), /temporary write error/);
  const sender = f.toolbar!.webContents;
  assert.equal((f.invoke({ sender, senderFrame: sender.mainFrame }) as BoardSnapshot).available, true);
  f.journal.startPreview = startPreview;
  await f.board.setVisible(true); assert.equal(f.windows[0].shown, true);
  f.board.dispose();
});

test('stopping while a visible layout is being saved cannot reopen a late canvas window', async () => {
  const f = await fixture(); let saved!: () => void;
  const append = f.journal.append;
  f.journal.append = async action => {
    await new Promise<void>(resolve => { saved = resolve; }); await append(action);
  };
  const opening = f.board.setVisible(true);
  await new Promise(resolve => setImmediate(resolve));
  f.board.update({ status: 'stopping' }); saved(); await opening;
  assert.equal(f.windows[0].shown, false); f.board.dispose();
});


const cameraState = { status: 'recording', cameraSessionId: 'prepared-camera', cameraAvailable: true,
  cameraVisible: true } as LiveRecordingState;
test('camera board expands to the captured area, records motion, blocks conflicting input and restores interface without losing ink', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher'); await f.board.setVisible(true); await f.choose('interface');
  const bounds = { ...f.windows[0].getBounds() };
  await f.request('action', 'first', { kind: 'text', id: 'ink', color: '#20242c', size: 32, x: 100, y: 100, text: '保留' });
  f.board.updateCamera(cameraState, { x: 1400, y: 800, width: 250, height: 160 });
  const preview = f.request('camera-ready') as { sessionId: string };
  const entering = f.request('backdrop', 'first', 'camera', .4);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((f.request('snapshot') as BoardSnapshot).sceneBusy, true);
  await assert.rejects(Promise.resolve(f.request('action', 'first', { kind: 'clear' })), /不可书写/);
  await assert.rejects(Promise.resolve(f.request('maximized', 'first', true)), /铺满/);
  await entering;
  assert.deepEqual(f.windows[0].getBounds(), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal((f.request('snapshot') as BoardSnapshot).presentation, 'canvas');
  const motion = f.events.find(action => action.kind === 'layout' && action.cameraTransition);
  assert.equal(motion?.kind === 'layout' && motion.cameraTransition?.direction, 'enter');
  await f.request('backdrop', 'first', 'white');
  assert.deepEqual(f.windows[0].getBounds(), bounds);
  assert.equal((f.request('snapshot') as BoardSnapshot).presentation, 'interface');
  assert.equal(f.events.filter(action => action.kind === 'text').length, 1);
  assert.doesNotThrow(() => f.request('camera-signal', { sessionId: preview.sessionId,
    signal: { type: 'viewport', viewport: { width: 640, height: 360, density: 1, visible: true, revision: 1 } } }));
  assert.equal(f.covered.at(-1), false); f.board.dispose();
});
test('camera entry requires a source and stopping mid-transition cannot hide the floating preview or reopen a late board', async () => {
  const f = await fixture(); await f.board.setVisible(true);
  await assert.rejects(Promise.resolve(f.request('backdrop', 'first', 'camera')), /开启/);
  f.board.updateCamera(cameraState);
  const entering = f.request('backdrop', 'first', 'camera'); await new Promise(resolve => setImmediate(resolve));
  f.board.update({ status: 'stopping' }); await entering;
  assert.equal(f.windows[0].shown, false); assert.equal(f.covered.at(-1), false);
  assert.equal((f.request('snapshot') as BoardSnapshot).sceneBusy, false); f.board.dispose();
});
test('failed capture exclusion rolls scene entry back to the prior bounds and presentation', async () => {
  const f = await fixture(); await f.board.setVisible(true); f.presentation.mode = 'interface';
  const bounds = { ...f.windows[0].getBounds() }; f.board.updateCamera(cameraState);
  f.include(async () => { throw new Error('capture policy unavailable'); });
  await assert.rejects(Promise.resolve(f.request('backdrop', 'first', 'camera')), /capture policy/);
  assert.deepEqual(f.windows[0].getBounds(), bounds);
  const state = f.request('snapshot') as BoardSnapshot;
  assert.equal(state.backdrop, 'white'); assert.equal(state.sceneBusy, false); assert.equal(state.presentation, 'interface');
  f.board.dispose();
});

test('only explicit hidden-to-visible opens reset content; prewritten preparation resumes into recording', async () => {
  const f = await fixture('frameflow://app/index.html?overlay=launcher', true);
  await f.board.setVisible(true); assert.equal(f.resets.length, 1);
  await f.board.setVisible(true); assert.equal(f.resets.length, 1);
  await f.request('action', 'draft', { kind: 'text', id: 'prepared', color: '#20242c', size: 32, x: 10, y: 10, text: '录前写好' });
  f.board.update({ status: 'starting' }); f.journal.session = 'capture'; await f.prepare();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.resets.length, 1, 'Automatic recording resume must preserve the preparation');
  await f.board.setVisible(false); await f.board.setVisible(true);
  assert.equal(f.resets.length, 2); f.board.dispose();
});

test('returning during camera entry is immediate and a late animation cannot bring it back', async () => {
  const f = await fixture(); await f.board.setVisible(true);
  const bounds = { ...f.windows[0].getBounds() }; f.board.updateCamera(cameraState);
  const entering = f.request('backdrop', 'first', 'camera'); await new Promise(resolve => setImmediate(resolve));
  await f.request('backdrop', 'first', 'white');
  assert.equal((f.request('snapshot') as BoardSnapshot).backdrop, 'white');
  assert.equal((f.request('snapshot') as BoardSnapshot).sceneBusy, false);
  assert.deepEqual(f.windows[0].getBounds(), bounds);
  await entering; assert.equal((f.request('snapshot') as BoardSnapshot).backdrop, 'white');
  assert.equal(f.covered.at(-1), false); f.board.dispose();
});

test('failed return retains its original recovery point and can be retried without losing the camera controls', async () => {
  const f = await fixture(); await f.board.setVisible(true); f.presentation.mode = 'interface';
  const bounds = { ...f.windows[0].getBounds() }; f.board.updateCamera(cameraState);
  await f.request('backdrop', 'first', 'camera');
  f.include(async () => { throw new Error('temporary inclusion failure'); });
  await assert.rejects(Promise.resolve(f.request('backdrop', 'first', 'white')), /inclusion/);
  assert.equal((f.request('snapshot') as BoardSnapshot).backdrop, 'camera');
  assert.equal((f.request('snapshot') as BoardSnapshot).sceneBusy, false);
  f.include(async () => {}); await f.request('backdrop', 'first', 'white');
  assert.equal((f.request('snapshot') as BoardSnapshot).backdrop, 'white');
  assert.deepEqual(f.windows[0].getBounds(), bounds); f.board.dispose();
});

test('late camera receiver cleanup cannot close a reopened lease or send retired viewport updates', async () => {
  const f = await fixture(); await f.board.setVisible(true); f.board.updateCamera(cameraState);
  const retired = f.request('camera-ready') as { sessionId: string };
  await f.board.setVisible(false);
  assert.doesNotThrow(() => f.request('camera-signal', { ...retired, signal: { type: 'close' } }));
  await f.board.setVisible(true);
  const current = f.request('camera-ready') as { sessionId: string };
  assert.doesNotThrow(() => f.request('camera-signal', { ...retired, signal: { type: 'close' } }));
  const signal = { type: 'viewport', viewport: { width: 640, height: 360, density: 1, visible: true, revision: 1 } };
  assert.throws(() => f.request('camera-signal', { ...retired, signal }), /会话已失效/);
  assert.doesNotThrow(() => f.request('camera-signal', { ...current, signal }));
  assert.throws(() => f.request('camera-signal', { sessionId: 'unknown', signal: { type: 'close' } }));
  f.board.dispose();
});
