import assert from 'node:assert/strict';
import test from 'node:test';
import type { Rectangle } from 'electron';
import { CAMERA_SHAPES } from '../shared/camera-shapes';
import { CameraSettingsWindow } from '../electron/services/recording-overlay/camera-settings-window';
import { cameraOverlayBounds, cameraSettingsReserve } from '../electron/services/recording-overlay/geometry';

const inside = (rectangle: Rectangle, area: Rectangle) => rectangle.x >= area.x && rectangle.y >= area.y
  && rectangle.x + rectangle.width <= area.x + area.width && rectangle.y + rectangle.height <= area.y + area.height;
const containsPoint = (regions: Rectangle[], x: number, y: number) => regions.some(region => x >= region.x && y >= region.y
  && x < region.x + region.width && y < region.y + region.height);

test('live size changes keep settings track and native origin fixed for all camera shapes and work-area edges', () => {
  for (const area of [{ x: -1536, y: -80, width: 1536, height: 832 }, { x: 0, y: 0, width: 640, height: 480 }]) {
    for (const shape of CAMERA_SHAPES) for (const x of [0, .5, 1]) for (const y of [0, .5, 1]) {
      const center = { x, y }, original = cameraOverlayBounds(area, .12, center, shape);
      let outer = original, writes = 0, regions: Rectangle[] = [];
      const settings = new CameraSettingsWindow({ bounds: () => outer, request: () => outer, area: () => area,
        setBounds: bounds => { outer = { ...bounds }; writes++; }, setRegions: value => { regions = value; },
        reserve: bounds => cameraSettingsReserve(bounds, area, center, shape), layoutKey: () => shape });
      settings.open();
      const fixedOuter = { ...outer }, fixedPanel = { ...settings.layout!.settings }, initialWrites = writes;
      assert.deepEqual(settings.cameraBounds, original); assert.ok(inside(outer, area));
      for (const size of [.15, .2, .25, .3, .35, .4, .42, .28, .12]) {
        const desired = cameraOverlayBounds(area, size, center, shape); settings.resize(desired);
        assert.deepEqual(outer, fixedOuter); assert.deepEqual(settings.layout!.settings, fixedPanel);
        assert.deepEqual(settings.cameraBounds, desired); assert.equal(writes, initialWrites);
        assert.ok(inside(desired, area));
        assert.equal(regions.length, 2);
        const frame = settings.layout!.camera;
        assert.ok(containsPoint(regions, frame.x + frame.width / 2, frame.y + frame.height / 2));
        assert.ok(containsPoint(regions, fixedPanel.x + 5, fixedPanel.y + 5));
      }
      let excluded = 0;
      for (let px = 0; px < outer.width; px += 7) for (let py = 0; py < outer.height; py += 7) {
        if (!containsPoint(regions, px, py)) excluded++;
      }
      assert.ok(excluded > 0, 'Unused reserve must be excluded from the native hit region');
      settings.close(); assert.deepEqual(outer, original); assert.deepEqual(regions, []);
    }
  }
});

test('impossible settings space preserves the original camera instead of shrinking or moving it', () => {
  const area = { x: 0, y: 0, width: 180, height: 120 }, camera = cameraOverlayBounds(area, .12, { x: .5, y: .5 });
  let writes = 0;
  const settings = new CameraSettingsWindow({ bounds: () => camera, request: () => camera, area: () => area,
    setBounds: () => { writes++; }, reserve: bounds => cameraSettingsReserve(bounds, area, { x: .5, y: .5 }, 'circle') });
  assert.throws(() => settings.open(), /空间不足/);
  assert.equal(writes, 0); assert.equal(settings.layout, undefined); assert.equal(settings.cameraBounds, undefined);
});
