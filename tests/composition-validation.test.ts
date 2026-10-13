import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCompositionBackgrounds, parseCompositions } from '../electron/services/composition-validation';
import { BACKGROUNDS } from '../shared/constants';

const assetId = '12345678-1234-1234-1234-123456789abc';
const segment = { id: 'local-1', start: 1, end: 4, screen: 'recording', camera: { x: .6, y: .5, size: .28, visible: true } };

test('local composition accepts custom small-window position and size without shared references', () => {
  const parsed = parseCompositions([segment], 10, 60);
  assert.deepEqual(parsed, [segment]);
  assert.notEqual(parsed[0], segment);
  assert.notEqual(parsed[0].camera, segment.camera);
  parsed[0].camera!.size = .4;
  assert.equal(segment.camera.size, .28);
  assert.equal(parseCompositions([{ ...segment, camera: { size: 1.5 }, screen: 'hidden' }], 10, 60)[0].camera?.size, 1.5);
});

test('local composition rejects overlap, duplicates, unsorted ranges and sub-frame edits', () => {
  for (const invalid of [
    [{ ...segment, start: NaN }], [{ ...segment, start: -1 }], [{ ...segment, end: 11 }],
    [{ ...segment, end: 1 + 1 / 120 }], [segment, { ...segment, id: 'two', start: 3 }],
    [segment, { ...segment, start: 5, end: 6 }], [{ ...segment, start: 5, end: 6 }, segment],
  ]) assert.throws(() => parseCompositions(invalid, 10, 60));
  assert.equal(parseCompositions([segment, { ...segment, id: 'two', start: 4, end: 4 + 1 / 60 }], 10, 60).length, 2);
});

test('local composition validates independent screen and camera settings', () => {
  for (const patch of [
    { screen: 'presenter' }, { screen: 'background' }, { background: 'https://example.invalid/image.png' },
    { camera: { size: .01 } }, { camera: { size: 3 } }, { camera: { x: Infinity } },
    { camera: { y: -.1 } }, { camera: { shape: 'unknown' } }, { camera: { visible: 1 } },
    { camera: { file: 'private-file' } }, { unknown: 'value' },
  ]) assert.throws(() => parseCompositions([{ ...segment, ...patch }], 10, 60));
  assert.equal(parseCompositions([{ ...segment, screen: 'background', background: BACKGROUNDS[0].id }], 10, 60)[0].screen, 'background');
});

test('local background references are restricted to registered project assets', () => {
  const parsed = parseCompositions([{ ...segment, screen: 'background', background: `asset:${assetId}` }], 10, 60);
  assert.doesNotThrow(() => assertCompositionBackgrounds(parsed, new Set([assetId])));
  assert.throws(() => assertCompositionBackgrounds(parsed, new Set()));
  assert.throws(() => parseCompositions([{ ...segment, background: 'asset:../other-project' }], 10, 60));
});
