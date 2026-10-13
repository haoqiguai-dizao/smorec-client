import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import type { BrowserWindow } from 'electron';
import { DEFAULT_STYLE } from '../shared/constants';
import { FILL_CANVAS_STYLE } from '../shared/canvas-style';
import type { CanvasStyle, Project } from '../shared/types';
import { DesktopPreferences } from '../electron/services/desktop-preferences';
import type { ProjectStore } from '../electron/services/projects';

interface TestContext { preferences: DesktopPreferences; importFile: string }
const bundledStore = build({ entryPoints: [path.resolve('electron/services/projects.ts')], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
    name: 'isolated-project-canvas', setup(builder) {
      builder.onResolve({ filter: /^canvas-test-context$/ }, args => ({ path: args.path, external: true }));
      builder.onResolve({ filter: /^electron$|^\.\/user-preferences$|^\.\/diagnostics$|^\.\/ffmpeg$/ },
        args => ({ path: args.path, namespace: 'canvas-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'canvas-test' }, args => {
        const source = args.path === 'electron'
          ? `export const app={getPath(){throw Error('Real profile access is forbidden')}};
            export const dialog={async showOpenDialog(){return {canceled:false,filePaths:[context.importFile]}}};
            export const shell={};`
          : args.path === './user-preferences' ? 'export const userPreferences=context.preferences;'
            : args.path === './diagnostics' ? 'export const diagnostic=()=>{};'
              : `export const probeMedia=async()=>({duration:2,width:1440,height:900,hasAudio:false,browserCompatible:true});
                export function normalizeMedia(){throw Error('Real conversion is forbidden')}
                export function ffmpegPath(){throw Error('Real media processes are forbidden')}`;
        return { loader: 'js', contents: `import context from 'canvas-test-context'; ${source}` };
      });
    },
  }] });

async function createStore(context: TestContext, root: string): Promise<ProjectStore> {
  const module = { exports: {} }, require = createRequire(import.meta.url);
  const testRequire = (name: string) => name === 'canvas-test-context' ? context : require(name);
  new Function('require', 'module', 'exports', (await bundledStore).outputFiles[0].text)(testRequire, module, module.exports);
  const Store = (module.exports as { ProjectStore: typeof ProjectStore }).ProjectStore;
  return new Store({ root: () => root });
}

async function fixture(run: (context: {
  preferences: DesktopPreferences; store: ProjectStore; root: string;
}) => Promise<void>) {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'new-project-canvas-'));
  const root = path.join(directory, 'projects'), profile = path.join(directory, 'profile');
  const importFile = path.join(directory, 'imported.mp4');
  const preferences = new DesktopPreferences(() => profile);
  try {
    await fs.mkdir(root); await fs.mkdir(profile);
    await fs.writeFile(importFile, 'Synthetic metadata fixture, never decoded');
    await fs.writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ version: 1,
      style: { ...DEFAULT_STYLE, aspect: '16:9', padding: 64, radius: 20, shadow: 40 } }));
    const store = await createStore({ preferences, importFile }, root);
    await run({ preferences, store, root });
  } finally {
    preferences.flush();
    const resolved = await fs.realpath(directory), relative = path.relative(output, resolved);
    assert.ok(relative.startsWith('new-project-canvas-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    assert.equal((await fs.lstat(directory)).isSymbolicLink(), false);
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

async function recording(store: ProjectStore, presenter = false): Promise<Project> {
  const { id, directory } = await store.createDirectory();
  await fs.writeFile(path.join(directory, 'screen.mp4'), 'Synthetic metadata fixture, never decoded');
  await fs.writeFile(path.join(directory, 'cursor.json'), '[]');
  return store.acceptRecording({ directory, duration: 2, width: 1440, height: 900, video: 'screen.mp4', cursor: 'cursor.json' },
    { sourceId: 'window:fixture', fps: 30, microphone: false, systemAudio: false,
      ...(presenter ? { cameraSessionId: 'synthetic-unavailable-camera' } : {}) }, id, directory, undefined, [], [],
    presenter ? [{ t: 0, mode: 'presenter' }] : []);
}

async function recovery(store: ProjectStore): Promise<Project> {
  const { id, directory } = await store.createDirectory();
  await fs.writeFile(path.join(directory, 'screen.mp4'), 'Synthetic metadata fixture, never decoded');
  await fs.writeFile(path.join(directory, 'recording.recovery.json'), JSON.stringify({
    createdAt: '2026-09-08T00:00:00Z', clockOrigin: 0, options: { fps: 30, microphone: false, systemAudio: false },
  }));
  store.endWrite(id);
  const project = await store.recover(id); assert.ok(project);
  return project;
}

test('ordinary recordings, imports and crash recovery share migrated source-aspect defaults', async () => {
  await fixture(async ({ preferences, store }) => {
    const expected = { ...DEFAULT_STYLE, ...FILL_CANVAS_STYLE };
    const captured = await recording(store);
    assert.deepEqual(captured.style, expected);
    assert.equal(captured.width, 1440); assert.equal(captured.height, 900, 'A 16:10 source is not relabeled 16:9');
    const imported = await store.importVideo({} as BrowserWindow); assert.ok(imported);
    assert.deepEqual(imported.style, { ...expected, showCursor: false });
    assert.deepEqual((await recovery(store)).style, expected);
    assert.deepEqual(preferences.read().style, expected);
    const presenter = await recording(store, true);
    assert.equal(presenter.style.aspect, '16:9');
    assert.equal(presenter.style.padding, 0);
    assert.equal(preferences.read().style.aspect, 'auto', 'Presenter layout must not replace ordinary recording defaults');
  });
});

test('later deliberate defaults apply to recordings, imports and recovery without sharing mutable style objects', async () => {
  await fixture(async ({ preferences, store }) => {
    preferences.update({ style: { aspect: '1:1', padding: 80, radius: 24, shadow: 50, background: 'sand' } });
    preferences.flush();
    const expected = preferences.read().style;
    const captured = await recording(store), recovered = await recovery(store);
    const imported = await store.importVideo({} as BrowserWindow); assert.ok(imported);
    assert.deepEqual(captured.style, expected); assert.deepEqual(recovered.style, expected);
    assert.deepEqual(imported.style, { ...expected, showCursor: false });
    captured.style.padding = 0; recovered.style.radius = 0;
    assert.deepEqual(preferences.read().style, expected);
  });
});

test('opening and saving an existing project keeps its saved canvas while future defaults migrate', async () => {
  await fixture(async ({ preferences, store, root }) => {
    const id = randomUUID(), directory = path.join(root, id);
    const style: CanvasStyle = { ...DEFAULT_STYLE, background: 'dusk', aspect: '16:9', padding: 64, radius: 20, shadow: 40 };
    const project: Project = { id, name: 'Existing project', createdAt: '2026-09-01T00:00:00Z', duration: 2,
      width: 1440, height: 900, fps: 30, media: { screen: 'screen.mp4' }, cursor: [],
      clips: [{ id: randomUUID(), start: 0, end: 2 }], zooms: [], style, audio: { system: 1, microphone: 1 } };
    await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'screen.mp4'), 'Synthetic fixture');
    const manifest = JSON.stringify({ version: 1, project, embeddedAudio: false });
    await fs.writeFile(path.join(directory, 'project.json'), manifest);
    assert.deepEqual(preferences.read().style, { ...DEFAULT_STYLE, ...FILL_CANVAS_STYLE });
    const opened = await store.load(id); assert.deepEqual(opened.style, style);
    assert.equal(await fs.readFile(path.join(directory, 'project.json'), 'utf8'), manifest);
    await store.save(opened);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8')).project.style, style);
    assert.deepEqual(preferences.read().style, { ...DEFAULT_STYLE, ...FILL_CANVAS_STYLE },
      'An unchanged old canvas cannot restore the previous defaults');
  });
});
