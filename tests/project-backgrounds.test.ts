import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import ffmpeg from 'ffmpeg-static';
import { DEFAULT_STYLE } from '../shared/constants';
import type { Project } from '../shared/types';
import type { ProjectStore } from '../electron/services/projects';
import { CanvasBackgroundDefaults } from '../electron/services/canvas-background-defaults';

async function storeClass(): Promise<typeof ProjectStore> {
  const bundled = await build({ entryPoints: [path.resolve('electron/services/projects.ts')], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'background-store-isolation', setup(builder) {
      builder.onResolve({ filter: /^electron$|^\.\/user-preferences$|^\.\/diagnostics$|^\.\/ffmpeg$/ }, args => ({ path: args.path, namespace: 'background-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'background-test' }, args => ({ loader: 'js', contents: args.path === 'electron'
        ? 'export const app={isPackaged:false,getPath(){throw Error("Real profile forbidden")}}; export const dialog={showOpenDialog:async()=>globalThis.backgroundTestChoice}; export const shell={};'
        : args.path === './ffmpeg' ? `export const ffmpegPath=()=>${JSON.stringify(ffmpeg)}; export const probeMedia=()=>{throw Error('No real media probes')}; export const normalizeMedia=()=>{throw Error('No video conversion')};`
        : args.path === './user-preferences' ? 'export const userPreferences={update(){},read(){throw Error("Real preferences forbidden")}};'
          : 'export const diagnostic=()=>{};' }));
    } }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return (module.exports as { ProjectStore: typeof ProjectStore }).ProjectStore;
}
const Store = storeClass();
const choice = globalThis as typeof globalThis & { backgroundTestChoice?: { canceled: boolean; filePaths: string[] } };

async function syntheticPng(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x24',
      '-frames:v', '1', '-threads', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], { windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk)); child.stderr.resume();
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('Fixture failed')));
  });
}

async function fixture(run: (value: { store: ProjectStore; project: Project; root: string; directory: string; image: string;
  defaults: CanvasBackgroundDefaults; defaultsDirectory: string }) => Promise<void>) {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const outer = await fs.mkdtemp(path.join(output, 'project-backgrounds-')), root = path.join(outer, 'managed');
  await fs.mkdir(root);
  const project: Project = { id: randomUUID(), name: 'Fixture', createdAt: '2026-09-08T00:00:00Z', duration: 4,
    width: 1280, height: 720, fps: 30, media: { screen: 'screen.mp4' }, cursor: [],
    clips: [{ id: randomUUID(), start: 0, end: 4 }], zooms: [], style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 } };
  const directory = path.join(root, project.id), image = path.join(outer, 'synthetic-background.png');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'screen.mp4'), 'Synthetic metadata fixture, not captured media');
  await fs.writeFile(path.join(directory, 'project.json'), JSON.stringify({ version: 1, project, embeddedAudio: false }));
  await fs.writeFile(image, await syntheticPng());
  const defaultsDirectory = path.join(outer, 'defaults');
  const defaults = new CanvasBackgroundDefaults(() => defaultsDirectory);
  try { await run({ store: new (await Store)({ root: () => root, canvasBackgrounds: defaults }), project, root, directory, image,
    defaults, defaultsDirectory }); }
  finally {
    delete choice.backgroundTestChoice;
    const real = await fs.realpath(outer), relative = path.relative(output, real);
    assert.ok(relative.startsWith('project-backgrounds-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    assert.equal((await fs.lstat(outer)).isSymbolicLink(), false);
    await fs.rm(real, { recursive: true, force: true });
  }
}

test('background import registers an immutable normalized asset and stale autosaves cannot remove or overwrite it', async () => {
  await fixture(async ({ store, project, directory, image }) => {
    const stale = await store.load(project.id);
    choice.backgroundTestChoice = { canceled: false, filePaths: [image] };
    const asset = await store.importBackground(project.id, {} as Electron.BrowserWindow);
    assert.ok(asset);
    assert.equal(asset.src, `frameflow://background/${project.id}/${asset.id}`);
    const filename = await store.background(project.id, asset.id), bytes = await fs.readFile(filename);
    assert.equal(path.basename(filename), `background-${asset.id}.png`);
    stale.backgrounds = [{ id: asset.id, name: 'Untrusted rename', src: 'C:\\private.png' }];
    stale.compositions = [{ id: randomUUID(), start: 1, end: 3, screen: 'background', background: `asset:${asset.id}` }];
    await store.save(stale);
    const loaded = await store.load(project.id);
    assert.deepEqual(loaded.backgrounds, [asset]);
    assert.equal(loaded.compositions?.[0].background, `asset:${asset.id}`);
    assert.deepEqual(await fs.readFile(filename), bytes);
    const persisted = JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8')).project;
    assert.equal(persisted.backgrounds[0].src, `background-${asset.id}.png`);
    assert.equal(persisted.backgrounds[0].name, 'synthetic-background');
    await assert.rejects(store.background(randomUUID(), asset.id));
    await assert.rejects(store.background(project.id, randomUUID()));
    const invalid = { ...loaded, compositions: [{ ...loaded.compositions![0], background: `asset:${randomUUID()}` }] };
    await assert.rejects(store.save(invalid), /背景/);
    await assert.rejects(store.save({ ...loaded, duration: 20, compositions: [{ ...loaded.compositions![0], end: 10 }] }));
    const withoutComposition = { ...loaded }; delete withoutComposition.compositions;
    await store.save(withoutComposition);
    assert.equal((await store.load(project.id)).compositions, undefined);
    assert.deepEqual((await store.load(project.id)).backgrounds, [asset]);
  });
});

test('cancelled selection leaves the project untouched and concurrent imports plus saves retain every asset', async () => {
  await fixture(async ({ store, project, image }) => {
    const stale = await store.load(project.id);
    choice.backgroundTestChoice = { canceled: true, filePaths: [] };
    assert.equal(await store.importBackground(project.id, {} as Electron.BrowserWindow), null);
    assert.equal((await store.load(project.id)).backgrounds, undefined);
    choice.backgroundTestChoice = { canceled: false, filePaths: [image] };
    const first = store.importBackground(project.id, {} as Electron.BrowserWindow);
    const second = store.importBackground(project.id, {} as Electron.BrowserWindow);
    const save = store.save(stale);
    const [a, b] = await Promise.all([first, second, save]);
    assert.ok(a && b && a.id !== b.id);
    await store.save(stale);
    assert.deepEqual((await store.load(project.id)).backgrounds?.map(asset => asset.id), [a.id, b.id]);
  });
});

test('opening a project copies its registered backgrounds into the new project and issues new project-scoped URLs', async () => {
  await fixture(async ({ store, project, root, directory, image }) => {
    await store.load(project.id);
    choice.backgroundTestChoice = { canceled: false, filePaths: [image] };
    const asset = await store.importBackground(project.id, {} as Electron.BrowserWindow);
    assert.ok(asset);
    const otherRoot = path.join(path.dirname(root), 'imported'); await fs.mkdir(otherRoot);
    const target = new (await Store)({ root: () => otherRoot });
    choice.backgroundTestChoice = { canceled: false, filePaths: [path.join(directory, 'project.json')] };
    const copy = await target.open({} as Electron.BrowserWindow);
    assert.ok(copy && copy.id !== project.id);
    assert.equal(copy.backgrounds?.[0].src, `frameflow://background/${copy.id}/${asset.id}`);
    assert.deepEqual(await fs.readFile(await target.background(copy.id, asset.id)), await fs.readFile(await store.background(project.id, asset.id)));
  });
});

test('canvas image survives source removal, project reload and restarted defaults, with an independent new-project copy', async () => {
  await fixture(async ({ store, project, root, directory, image, defaultsDirectory }) => {
    const loaded = await store.load(project.id);
    choice.backgroundTestChoice = { canceled: false, filePaths: [image] };
    const asset = await store.importBackground(project.id, {} as Electron.BrowserWindow);
    assert.ok(asset);
    await store.save({ ...loaded, style: { ...loaded.style, background: `asset:${asset.id}` } });
    await fs.rm(image);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8'));
    assert.equal(manifest.version, 11);
    const reopened = await new (await Store)({ root: () => root }).load(project.id);
    assert.equal(reopened.style.background, `asset:${asset.id}`);
    const bytes = await fs.readFile(await store.background(project.id, asset.id));
    await fs.rm(path.join(directory, `background-${asset.id}.png`));
    const defaults = new CanvasBackgroundDefaults(() => defaultsDirectory), next = { ...project, style: { ...DEFAULT_STYLE } };
    const nextDirectory = path.join(path.dirname(root), 'new-project'); await fs.mkdir(nextDirectory);
    await defaults.apply(next, nextDirectory);
    assert.equal(next.style.background, `asset:${asset.id}`);
    assert.deepEqual(await fs.readFile(path.join(nextDirectory, next.backgrounds![0].src)), bytes);
    assert.notEqual(next.backgrounds![0].src, asset.src);
    await assert.rejects(store.save({ ...reopened, style: { ...reopened.style, background: `asset:${randomUUID()}` } }));
  });
});

test('switching back to presets clears only the remembered copy, while existing project images remain available', async () => {
  await fixture(async ({ store, project, directory, image, defaults, defaultsDirectory }) => {
    const loaded = await store.load(project.id);
    choice.backgroundTestChoice = { canceled: false, filePaths: [image] };
    const first = await store.importBackground(project.id, {} as Electron.BrowserWindow);
    const second = await store.importBackground(project.id, {} as Electron.BrowserWindow);
    assert.ok(first && second);
    await store.save({ ...loaded, style: { ...loaded.style, background: `asset:${first.id}` } });
    await store.save({ ...loaded, style: { ...loaded.style, background: `asset:${second.id}` } });
    assert.deepEqual((await fs.readdir(defaultsDirectory)).sort(), [`background-${second.id}.png`, 'selection.json'].sort());
    await store.save({ ...loaded, style: { ...loaded.style, background: 'mint' } });
    assert.deepEqual(await fs.readdir(defaultsDirectory), ['selection.json']);
    assert.ok(await fs.stat(path.join(directory, `background-${first.id}.png`)));
    assert.ok(await fs.stat(path.join(directory, `background-${second.id}.png`)));
    const next = { ...project, style: { ...DEFAULT_STYLE } };
    await defaults.apply(next, directory);
    assert.equal(next.style.background, DEFAULT_STYLE.background);
    await fs.writeFile(path.join(defaultsDirectory, 'selection.json'), '{broken optional defaults');
    await new CanvasBackgroundDefaults(() => defaultsDirectory).apply(next, directory);
    assert.equal(next.backgrounds, undefined);
  });
});

test('saving an unchanged old canvas image cannot replace the most recently selected default', async () => {
  await fixture(async ({ store, project, directory, image, defaults, defaultsDirectory }) => {
    const loaded = await store.load(project.id);
    choice.backgroundTestChoice = { canceled: false, filePaths: [image] };
    const first = await store.importBackground(project.id, {} as Electron.BrowserWindow);
    const second = await store.importBackground(project.id, {} as Electron.BrowserWindow);
    assert.ok(first && second);
    await store.save({ ...loaded, style: { ...loaded.style, background: `asset:${first.id}` } });
    const current = store.get(project.id).project;
    await defaults.remember({ ...current, style: { ...current.style, background: `asset:${second.id}` } }, directory);
    await store.save(await store.load(project.id));
    assert.equal(JSON.parse(await fs.readFile(path.join(defaultsDirectory, 'selection.json'), 'utf8')).id, second.id);
  });
});
