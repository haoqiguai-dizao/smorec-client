import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { DEFAULT_STYLE } from '../shared/constants';
import type { CanvasSize } from '../shared/canvas';

test('production preview hook responds to container, DPR and visibility without growing its CSS from bitmap size', async () => {
  const hooks: (() => () => void)[] = [];
  const bundled = await build({ entryPoints: ['src/hooks/usePreviewResolution.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'hook-host', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'hook-host' }));
      builder.onLoad({ filter: /.*/, namespace: 'hook-host' }, () => ({ contents:
        'export const useRef=value=>({current:value}); export const useLayoutEffect=effect=>hooks.push(effect);' }));
    } }] });
  const listeners = new Map<string, () => void>(), timers = new Map<number, () => void>();
  let nextTimer = 0, changed = 0, suspended = 0, observed: unknown, disconnected = false;
  let resized!: () => void, densityChanged!: () => void;
  const surface = { width: 1016, height: 562 };
  const container = { getBoundingClientRect: () => ({ ...surface }) };
  const canvas = { closest: () => container, width: 300, height: 150, style: { width: '', height: '' } };
  const document = { hidden: false, addEventListener: (name: string, action: () => void) => listeners.set(name, action),
    removeEventListener: (name: string) => listeners.delete(name) };
  const window = { devicePixelRatio: 1.5, addEventListener: document.addEventListener, removeEventListener: document.removeEventListener };
  class Observer {
    constructor(action: () => void) { resized = action; }
    observe(target: unknown) { observed = target; }
    disconnect() { disconnected = true; }
  }
  const matchMedia = () => ({ addEventListener: (_name: string, action: () => void) => { densityChanged = action; },
    removeEventListener: () => {} });
  const module = { exports: {} as { usePreviewResolution: (...args: unknown[]) => { current: CanvasSize | null } } };
  new Function('module', 'exports', 'hooks', 'window', 'document', 'ResizeObserver', 'matchMedia', 'getComputedStyle',
    'setTimeout', 'clearTimeout', bundled.outputFiles[0].text)(module, module.exports, hooks, window, document, Observer,
    matchMedia, () => ({ paddingLeft: '28px', paddingRight: '28px', paddingTop: '12px', paddingBottom: '10px' }),
    (action: () => void) => { timers.set(++nextTimer, action); return nextTimer; }, (id: number) => timers.delete(id));
  const size = module.exports.usePreviewResolution({ current: canvas }, {
    id: 'preview', width: 3840, height: 2160, style: { ...DEFAULT_STYLE, aspect: '16:9' },
  }, () => { changed++; }, () => { suspended++; });
  const cleanup = hooks[0]();
  const flush = () => { for (const [id, action] of [...timers]) { timers.delete(id); action(); } };
  assert.equal(observed, container);
  assert.deepEqual(size.current, { width: 1440, height: 810 });
  assert.deepEqual(canvas.style, { width: '960px', height: '540px' });
  assert.equal(changed, 1);

  surface.width = 1256; surface.height = 697; resized();
  surface.width = 1336; surface.height = 742; resized();
  assert.equal(timers.size, 1, 'Resize bursts retain only the trailing latest update');
  assert.deepEqual(size.current, { width: 1440, height: 810 });
  flush();
  assert.deepEqual(size.current, { width: 1920, height: 1080 });
  assert.deepEqual(canvas.style, { width: '1280px', height: '720px' });

  window.devicePixelRatio = 2; densityChanged(); flush();
  assert.deepEqual(size.current, { width: 2560, height: 1440 });
  assert.deepEqual(canvas.style, { width: '1280px', height: '720px' });
  document.hidden = true; listeners.get('visibilitychange')!();
  assert.equal(size.current, null);
  assert.equal(suspended, 1, 'Hidden editor pauses video/camera/audio through its supplied pause callback');
  const beforeHiddenResize = changed;
  resized(); flush(); assert.equal(changed, beforeHiddenResize);
  document.hidden = false; listeners.get('visibilitychange')!();
  assert.deepEqual(size.current, { width: 2560, height: 1440 });
  assert.equal(changed, beforeHiddenResize + 1);

  resized(); assert.equal(timers.size, 1);
  cleanup(); assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
  assert.equal(disconnected, true); assert.equal(size.current, null);
});
