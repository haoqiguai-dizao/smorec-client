import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '../shared/types';
import { CompositionBackgroundCache } from '../src/services/composition-backgrounds';

test('background image cache loads only the active range, shares requests and releases old images', async () => {
  const originalFetch = globalThis.fetch, originalDecode = globalThis.createImageBitmap;
  const decoded: { closed: boolean; close(): void }[] = [];
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(new Blob(['generated fixture']), { status: 200 }); };
  globalThis.createImageBitmap = async () => {
    const image = { closed: false, close() { this.closed = true; } };
    decoded.push(image); return image as unknown as ImageBitmap;
  };
  const cache = new CompositionBackgroundCache();
  const project = {
    style: { background: 'aurora' },
    compositions: [0, 1, 2].map(index => ({ id: String(index), start: index, end: index + 1, screen: 'background', background: `asset:${index}` })),
    backgrounds: [0, 1, 2].map(index => ({ id: String(index), name: 'Fixture', src: `frameflow://background/test/${index}` })),
  } as unknown as Project;
  try {
    assert.equal(await cache.prepare(project, 3), undefined);
    assert.equal(requests, 0);
    const canvas = { ...project, style: { ...project.style, background: 'asset:0' } };
    assert.equal(cache.key(canvas, 3), canvas.backgrounds![0].src);
    assert.equal(cache.key({ ...canvas, compositions: [{ id: 'hide', start: 3, end: 4, screen: 'hidden' }] }, 3.5), undefined);
    assert.equal(cache.key({ ...canvas, compositions: [{ id: 'preset', start: 3, end: 4, screen: 'background', background: 'mint' }] }, 3.5), undefined);
    assert.equal(cache.key({ ...canvas, compositions: [{ id: 'recording', start: 3, end: 4, screen: 'recording' }] }, 3.5), canvas.backgrounds![0].src);
    const first = cache.prepare(project, .1), same = cache.prepare(project, .2);
    assert.equal(await first, await same); assert.equal(requests, 1);
    assert.equal(cache.peek(project, .5), decoded[0]);
    await cache.prepare(project, 1.5); await cache.prepare(project, 2.5);
    assert.equal(decoded[0].closed, true); assert.equal(decoded[1].closed, false);
    assert.equal(cache.peek(project, .5), undefined);
    await cache.prepare(project, .5); assert.equal(requests, 4);
    assert.throws(() => cache.key({ ...project, backgrounds: [] }, .5));
    cache.dispose(); assert.ok(decoded.every(item => item.closed));
    await assert.rejects(cache.prepare(project, .5), { name: 'AbortError' });
  } finally {
    cache.dispose(); globalThis.fetch = originalFetch;
    if (originalDecode) globalThis.createImageBitmap = originalDecode;
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  }
});
