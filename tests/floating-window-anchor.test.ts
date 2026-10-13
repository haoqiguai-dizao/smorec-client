import assert from 'node:assert/strict';
import test from 'node:test';
import type { Rectangle } from 'electron';
import { collapsedBarAnchor, remapBarAnchor, resizeFromAnchor } from '../electron/services/floating-window-anchor';

const primary = Object.freeze({ x: 0, y: 0, width: 1920, height: 1040 });

function fits(bounds: Rectangle, area: Rectangle): void {
  for (const value of Object.values(bounds)) assert.ok(Number.isFinite(value), 'Geometry must remain finite');
  assert.ok(bounds.width > 0 && bounds.height > 0);
  assert.ok(bounds.x >= area.x && bounds.y >= area.y);
  assert.ok(bounds.x + bounds.width <= area.x + area.width);
  assert.ok(bounds.y + bounds.height <= area.y + area.height);
}

test('a collapsed anchor retains the operation bar bottom without mutating expanded bounds', () => {
  const expanded = Object.freeze({ x: 120, y: 60, width: 660, height: 520 });
  const anchor = collapsedBarAnchor(expanded, 84);
  assert.deepEqual(anchor, { x: 120, y: 496, width: 660, height: 84 });
  assert.equal(anchor.y + anchor.height, expanded.y + expanded.height);
  assert.deepEqual(expanded, { x: 120, y: 60, width: 660, height: 520 });
});

test('settings near the top may clamp temporarily but repeated collapse restores the saved anchor', () => {
  const anchor = Object.freeze({ x: 600, y: 100, width: 660, height: 84 });
  for (let cycle = 0; cycle < 12; cycle++) {
    const expanded = resizeFromAnchor(anchor, primary, 520);
    assert.deepEqual(expanded, { x: 600, y: 0, width: 660, height: 520 });
    assert.deepEqual(resizeFromAnchor(anchor, primary, 84), anchor,
      `Cycle ${cycle} must collapse from the saved anchor, not the clamped expanded rectangle`);
  }
  assert.deepEqual(anchor, { x: 600, y: 100, width: 660, height: 84 });
});

test('settings with enough headroom preserve the same bottom at both heights', () => {
  const anchor = Object.freeze({ x: 600, y: 700, width: 660, height: 84 });
  assert.deepEqual(resizeFromAnchor(anchor, primary, 520), { x: 600, y: 264, width: 660, height: 520 });
  assert.deepEqual(resizeFromAnchor(anchor, primary, 84), anchor);
});

test('HUD round trips between equal adjacent displays without drifting to either edge', () => {
  const secondary = Object.freeze({ x: 1920, y: 0, width: 1920, height: 1040 });
  const saved = Object.freeze({ x: 745, y: 900, width: 430, height: 78 });
  let current: Rectangle = { ...saved };
  for (let cycle = 0; cycle < 12; cycle++) {
    current = remapBarAnchor(current, primary, secondary);
    assert.deepEqual(current, { x: 2665, y: 900, width: 430, height: 78 });
    current = remapBarAnchor(current, secondary, primary);
    assert.deepEqual(current, saved, `Display round trip ${cycle} must preserve the saved location`);
  }
  assert.deepEqual(saved, { x: 745, y: 900, width: 430, height: 78 });
  assert.deepEqual(primary, { x: 0, y: 0, width: 1920, height: 1040 });
  assert.deepEqual(secondary, { x: 1920, y: 0, width: 1920, height: 1040 });
});

test('different sized negative-coordinate displays preserve the fraction of available travel', () => {
  const anchor = Object.freeze({ x: 745, y: 481, width: 430, height: 78 });
  const left = Object.freeze({ x: -1600, y: -200, width: 1600, height: 900 });
  const mapped = remapBarAnchor(anchor, primary, left);
  assert.deepEqual(mapped, { x: -1015, y: 211, width: 430, height: 78 });
  fits(mapped, left);
  assert.deepEqual(remapBarAnchor(mapped, left, primary), anchor);
  assert.deepEqual(anchor, { x: 745, y: 481, width: 430, height: 78 });
  assert.deepEqual(left, { x: -1600, y: -200, width: 1600, height: 900 });
});

test('a target smaller than the bar clamps rendered size without changing the remembered rectangle', () => {
  const anchor = Object.freeze({ x: 745, y: 900, width: 430, height: 78 });
  const small = Object.freeze({ x: -300, y: -40, width: 300, height: 60 });
  const expected = { x: -300, y: -40, width: 300, height: 60 };
  assert.deepEqual(remapBarAnchor(anchor, primary, small), expected);
  assert.deepEqual(resizeFromAnchor(anchor, small, 420), expected);
  fits(resizeFromAnchor(anchor, small, 78), small);
  assert.deepEqual(anchor, { x: 745, y: 900, width: 430, height: 78 });
  assert.deepEqual(small, expected);
});

test('an unchanged work area preserves the exact saved rectangle', () => {
  const area = Object.freeze({ x: -1920, y: -100, width: 1920, height: 1040 });
  const anchor = Object.freeze({ x: -1517, y: 789, width: 430, height: 78 });
  assert.deepEqual(remapBarAnchor(anchor, area, { ...area }), anchor);
  assert.deepEqual(anchor, { x: -1517, y: 789, width: 430, height: 78 });
});

test('a source with no available travel still maps to finite reachable bounds', () => {
  const source = Object.freeze({ x: 10, y: 20, width: 430, height: 78 });
  const anchor = Object.freeze({ ...source });
  const mapped = remapBarAnchor(anchor, source, primary);
  fits(mapped, primary);
  assert.equal(mapped.width, 430);
  assert.equal(mapped.height, 78);
  assert.deepEqual(source, { x: 10, y: 20, width: 430, height: 78 });
  assert.deepEqual(anchor, source);
});
