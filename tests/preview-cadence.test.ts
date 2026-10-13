import assert from 'node:assert/strict';
import test from 'node:test';
import { PreviewCadence } from '../src/services/preview-cadence';

test('high refresh displays compose only project frames while overlays keep advancing', () => {
  for (const refresh of [60, 120, 144]) for (const fps of [30, 60]) {
    const cadence = new PreviewCadence();
    const accepted = Array.from({ length: refresh * 2 }, (_, i) => i / refresh).filter(t => cadence.take(t, fps));
    assert.equal(accepted.length, fps * 2);
    assert.equal(cadence.take(accepted.at(-1)!, fps), false);
  }
});

test('seeks, project changes and held video tails do not freeze the preview', () => {
  const cadence = new PreviewCadence();
  assert.equal(cadence.take(1.5, 30), true);
  assert.equal(cadence.take(1.5, 30), false);
  cadence.reset();
  assert.equal(cadence.take(1.5, 30), true);
  assert.equal(cadence.take(.1, 30), true);
  assert.equal(cadence.take(.1, 60), true);
  for (const time of [2, 2.1, 2.2]) assert.equal(cadence.take(time, 60), true);
});
