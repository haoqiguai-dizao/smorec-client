import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { captureExecutableCandidates, captureWindowHandle, nativeBuildHint } from '../electron/services/platform/capture-runtime';
import { pointInsideRegions } from '../shared/input-regions';

test('Mac selection cannot launch a Windows helper; resources take priority over development builds', () => {
  const candidates = captureExecutableCandidates({ platform: 'darwin', resourcesPath: '/App/Resources', appPath: '/source' });
  assert.equal(candidates[0], path.join('/App/Resources', 'native/XiaoLu.Capture.app/Contents/MacOS/小录采集'));
  assert.equal(candidates[1], path.join('/App/Resources', 'native/XiaoLu.Capture.app/Contents/MacOS/XiaoLu.Capture'));
  assert.equal(candidates[2], path.join('/App/Resources', 'native/XiaoLu.Capture'));
  assert.ok(candidates.every(candidate => !candidate.endsWith('.exe')));
  assert.deepEqual(captureExecutableCandidates({ platform: 'linux', resourcesPath: '/app', appPath: '/source' }), []);
});

test('Windows executable search and 32/64-bit HWND semantics remain supported', () => {
  const candidates = captureExecutableCandidates({ platform: 'win32', resourcesPath: '/app', appPath: '/source' });
  assert.equal(candidates.length, 4);
  assert.ok(candidates.every(candidate => candidate.endsWith('FrameFlow.Capture.exe')));
  const handle = Buffer.alloc(8); handle.writeBigUInt64LE(0x123456789an);
  assert.equal(captureWindowHandle(handle, 'win32'), '78187493530');
  assert.equal(captureWindowHandle(handle.subarray(0, 4), 'win32'), String(handle.readUInt32LE()));
  assert.equal(captureWindowHandle(handle, 'darwin'), undefined);
  assert.match(nativeBuildHint('darwin'), /native:mac:build/);
});

test('transparent window reserve stays outside interactive regions at fractional coordinates', () => {
  const regions = [{ x: 10.5, y: 50, width: 100, height: 80 }, { x: 220, y: 0, width: 90, height: 150 }];
  assert.equal(pointInsideRegions(10.5, 50, regions), true);
  assert.equal(pointInsideRegions(110.5, 50, regions), false);
  assert.equal(pointInsideRegions(150, 80, regions), false);
  assert.equal(pointInsideRegions(225, 80, regions), true);
  assert.equal(pointInsideRegions(150, 80, []), true);
});
