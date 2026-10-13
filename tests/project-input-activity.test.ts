import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { DesktopPreferences } from '../electron/services/desktop-preferences';
import type { ProjectStore } from '../electron/services/projects';
import type { InputActivity, Project } from '../shared/types';
import { cameraAt } from '../shared/timeline';

const bundle = build({ entryPoints: [path.resolve('electron/services/projects.ts')], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
    name: 'isolated-input-activity', setup(builder) {
      builder.onResolve({ filter: /^input-activity-context$/ }, args => ({ path: args.path, external: true }));
      builder.onResolve({ filter: /^electron$|^\.\/user-preferences$|^\.\/diagnostics$|^\.\/ffmpeg$/ },
        args => ({ path: args.path, namespace: 'input-activity-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'input-activity-test' }, args => {
        const source = args.path === 'electron'
          ? 'export const app={getPath(){throw Error("Real profile access forbidden")}};export const dialog={};export const shell={};'
          : args.path === './user-preferences' ? 'export const userPreferences=context.preferences;'
            : args.path === './diagnostics' ? 'export const diagnostic=()=>{};'
              : 'export const probeMedia=async()=>({duration:10,width:1280,height:720,hasAudio:false,browserCompatible:true});'
                + 'export function normalizeMedia(){throw Error("Real conversion forbidden")}'
                + 'export function ffmpegPath(){throw Error("Real media processes forbidden")}';
        return { loader: 'js', contents: `import context from 'input-activity-context'; ${source}` };
      });
    },
  }] });

async function fixture(run: (context: {
  store: () => ProjectStore; root: string;
  prepare: () => Promise<{ id: string; directory: string }>;
}) => Promise<void>) {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const outer = await fs.mkdtemp(path.join(output, 'project-input-activity-'));
  const root = path.join(outer, 'projects'), preferences = new DesktopPreferences(() => path.join(outer, 'profile'));
  const module = { exports: {} }, require = createRequire(import.meta.url);
  const testRequire = (name: string) => name === 'input-activity-context' ? { preferences } : require(name);
  new Function('require', 'module', 'exports', (await bundle).outputFiles[0].text)(testRequire, module, module.exports);
  const Store = (module.exports as { ProjectStore: typeof ProjectStore }).ProjectStore;
  const store = () => new Store({ root: () => root });
  try {
    await fs.mkdir(root);
    await run({ root, store, prepare: async () => {
      const project = await store().createDirectory();
      await fs.writeFile(path.join(project.directory, 'screen.mp4'), 'Synthetic metadata fixture, not decoded');
      await fs.writeFile(path.join(project.directory, 'cursor.json'), JSON.stringify([
        { t: 1, x: 0.3, y: 0.4, visible: true, click: true },
        { t: 3, x: 0.9, y: 0.9, visible: true },
      ]));
      return project;
    } });
  } finally {
    preferences.flush();
    const real = await fs.realpath(outer), relative = path.relative(output, real);
    assert.ok(relative.startsWith('project-input-activity-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    assert.equal((await fs.lstat(outer)).isSymbolicLink(), false);
    await fs.rm(real, { recursive: true, force: true });
  }
}

const events: InputActivity[] = Array.from({ length: 15 }, (_, index) => ({ t: 1.2 + index * 0.4, kind: 'typing' }));

test('new recording stores activity, holds the clicked focus, and reloads manual zoom edits without regeneration', async () => {
  await fixture(async ({ store, prepare, root }) => {
    const projects = store(), { id, directory } = await prepare();
    await fs.writeFile(path.join(directory, 'input-activity.json'), JSON.stringify(events));
    const project = await projects.acceptRecording({ directory, duration: 10, width: 1280, height: 720,
      video: 'screen.mp4', cursor: 'cursor.json', inputActivity: 'input-activity.json' },
    { sourceId: 'window:fixture', fps: 30, microphone: false, systemAudio: false }, id, directory);
    assert.deepEqual(project.inputActivity, events);
    assert.ok(cameraAt(project.zooms, 5).scale > 1.6);
    assert.equal(project.zooms[0].x, 0.3, 'Moving the mouse does not move the typing focus');
    const manual = [{ id: 'manual', start: 2, end: 8, x: 0.4, y: 0.6, scale: 2 }];
    await projects.save({ ...project, zooms: manual, inputActivity: [], cursor: [] });
    const reloaded = await store().load(id);
    assert.deepEqual(reloaded.inputActivity, events, 'Renderer edits cannot replace captured activity');
    assert.deepEqual(reloaded.zooms, manual, 'Opening or saving must never silently regenerate zooms');
    const stored = JSON.parse(await fs.readFile(path.join(root, id, 'project.json'), 'utf8')).project as Project;
    assert.deepEqual(stored.inputActivity, events);
    assert.ok(stored.inputActivity?.every(event => Object.keys(event).sort().join(',') === 'kind,t'));
  });
});

test('old recordings keep the original metadata shape and invalid activity paths cannot escape the project', async () => {
  await fixture(async ({ store, prepare }) => {
    const { id, directory } = await prepare(), projects = store();
    const result = { directory, duration: 10, width: 1280, height: 720, video: 'screen.mp4', cursor: 'cursor.json' };
    const options = { sourceId: 'window:fixture', fps: 30 as const, microphone: false, systemAudio: false };
    for (const inputActivity of ['../outside.json', 'D:\\outside.json', 'nested/activity.json']) {
      await assert.rejects(projects.acceptRecording({ ...result, inputActivity }, options, id, directory));
    }
    const legacy = await projects.acceptRecording(result, options, id, directory);
    assert.equal(Object.hasOwn(legacy, 'inputActivity'), false);
    assert.equal(cameraAt(legacy.zooms, 5).scale, 1);
  });
});

test('project crash recovery restores source-time input events while damaged input only adds a warning', async () => {
  await fixture(async ({ store, prepare }) => {
    for (const damaged of [false, true]) {
      const { id, directory } = await prepare(), projects = store();
      await fs.writeFile(path.join(directory, 'recording.recovery.json'), JSON.stringify({
        clockOrigin: 2, createdAt: '2026-09-08T00:00:00Z', options: { fps: 30 },
      }));
      const rows = events.map(event => JSON.stringify({ ...event, t: event.t + 2 })).join('\n');
      await fs.writeFile(path.join(directory, 'input-activity.recovery.jsonl'), damaged ? `${rows}\n{"t":` : rows);
      const warnings: string[] = [];
      projects.onRecovered = (_, items) => warnings.push(...items);
      const recovered = await projects.recover(id); assert.ok(recovered);
      if (damaged) {
        assert.equal(recovered.inputActivity, undefined);
        assert.equal(cameraAt(recovered.zooms, 5).scale, 1);
        assert.equal(warnings.length, 1);
      } else {
        assert.equal(recovered.inputActivity?.length, events.length);
        for (const [index, event] of recovered.inputActivity!.entries()) assert.ok(Math.abs(event.t - events[index].t) < 1e-9);
        assert.ok(cameraAt(recovered.zooms, 5).scale > 1.6);
        assert.deepEqual(warnings, []);
      }
      assert.equal(recovered.media.screen.includes('/screen'), true);
      assert.deepEqual((await store().load(id)).zooms, recovered.zooms);
    }
  });
});
