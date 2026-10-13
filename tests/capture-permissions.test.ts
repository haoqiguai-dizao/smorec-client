import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePermissionNeeds, capturePermissionState, permissionAccessLabel } from '../src/services/capture-permissions';
import type { PermissionStatus } from '../shared/platform-permissions';

test('only selected capture features are required; simple capture does not require activity access', () => {
  const needs = capturePermissionNeeds(false, false);
  assert.deepEqual(needs, ['screen']);
  assert.equal(capturePermissionState(needs, [{ kind: 'screen', granted: true }]).ready, true);
  assert.deepEqual(capturePermissionNeeds(true, true), ['screen', 'camera', 'microphone']);
});

test('complete activity capture requires both permissions; explicit opt-out removes only activity requirements', () => {
  const status: PermissionStatus[] = [{ kind: 'screen', granted: true }, { kind: 'microphone', granted: true },
    { kind: 'input', granted: true }, { kind: 'accessibility', granted: false }];
  assert.deepEqual(capturePermissionNeeds(false, true, true), ['screen', 'microphone', 'input', 'accessibility']);
  assert.equal(capturePermissionState(capturePermissionNeeds(false, true, true), status).ready, false);
  assert.equal(capturePermissionState(capturePermissionNeeds(false, true, false), status).ready, true);
});

test('unknown, denied and restricted requirements cannot appear ready', () => {
  const needs = capturePermissionNeeds(true, true);
  const status: PermissionStatus[] = [{ kind: 'screen', granted: true }, { kind: 'camera', granted: false, access: 'restricted' }];
  assert.deepEqual(capturePermissionState(needs, status), { unresolved: ['camera', 'microphone'], unknown: ['microphone'], ready: false });
  assert.equal(capturePermissionState(needs, null).ready, false);
  assert.equal(permissionAccessLabel(status[1]), '系统限制');
  assert.equal(permissionAccessLabel(undefined), '未读取');
});

test('explicitly opting out removes only that device requirement', () => {
  const status: PermissionStatus[] = [{ kind: 'screen', granted: true }, { kind: 'microphone', granted: true },
    { kind: 'camera', granted: false, access: 'denied' }];
  assert.equal(capturePermissionState(capturePermissionNeeds(true, true), status).ready, false);
  assert.equal(capturePermissionState(capturePermissionNeeds(false, true), status).ready, true);
  assert.equal(capturePermissionState(capturePermissionNeeds(true, false), status).ready, false);
});
