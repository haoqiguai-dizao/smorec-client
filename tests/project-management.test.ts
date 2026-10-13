import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { DEFAULT_STYLE } from '../shared/constants';
import type { Project } from '../shared/types';
import type { ProjectStore } from '../electron/services/projects';

async function storeClass(): Promise<typeof ProjectStore> {
  const bundled = await build({ entryPoints: [path.resolve('electron/services/projects.ts')], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'isolated-project-store', setup(builder) {
      builder.onResolve({ filter: /^electron$|^\.\/user-preferences$|^\.\/diagnostics$/ }, args => ({ path: args.path, namespace: 'project-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'project-test' }, args => ({ loader: 'js', contents: args.path === 'electron'
        ? 'export const app={getPath(){throw Error("Real profile access is forbidden")}}; export const dialog={}; export const shell={trashItem(){throw Error("Real trash is forbidden")},showItemInFolder(){throw Error("Real Explorer is forbidden")}};'
        : args.path === './user-preferences' ? 'export const userPreferences={update(){},read(){throw Error("Not needed in this fixture")}};'
          : 'export const diagnostic=()=>{};' }));
    } }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return (module.exports as { ProjectStore: typeof ProjectStore }).ProjectStore;
}
const Store = storeClass();

async function fixture(run: (context: {
  root: string; recycled: string; create: (name?: string) => Promise<Project>; read: (id: string) => Promise<Project>;
  store: (options?: { trashItem?: (directory: string) => Promise<void>; reveal?: (file: string) => void; onDeleted?: () => void }) => Promise<ProjectStore>;
}) => Promise<void>) {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const outer = await fs.mkdtemp(path.join(output, 'project-management-'));
  const root = path.join(outer, 'projects'), recycled = path.join(outer, 'mock-recycle-bin');
  await fs.mkdir(root); await fs.mkdir(recycled);
  const read = async (id: string) => JSON.parse(await fs.readFile(path.join(root, id, 'project.json'), 'utf8')).project as Project;
  try {
    await run({ root, recycled, read,
      create: async (name = 'Original name') => {
        const project: Project = { id: randomUUID(), name, createdAt: '2026-09-07T00:00:00Z', duration: 2,
          width: 1280, height: 720, fps: 30, media: { screen: 'screen.mp4' }, cursor: [],
          clips: [{ id: randomUUID(), start: 0, end: 2 }], zooms: [], style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 } };
        const directory = path.join(root, project.id); await fs.mkdir(directory);
        await fs.writeFile(path.join(directory, 'screen.mp4'), 'Synthetic metadata fixture; no audio or video content');
        await fs.writeFile(path.join(directory, 'project.json'), JSON.stringify({ version: 1, project, embeddedAudio: false }));
        return project;
      },
      store: async options => new (await Store)({ root: () => root,
        trashItem: directory => fs.rename(directory, path.join(recycled, path.basename(directory))), ...options }),
    });
  } finally {
    const resolved = await fs.realpath(outer), relative = path.relative(output, resolved);
    assert.ok(relative.startsWith('project-management-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    assert.equal((await fs.lstat(outer)).isSymbolicLink(), false);
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

test('an unloaded project can be renamed and revealed without modifying media or other settings', async () => {
  await fixture(async ({ root, create, read, store }) => {
    const project = await create(), revealed: string[] = [], projects = await store({ reveal: file => { revealed.push(file); } });
    const summary = await projects.rename(project.id.toUpperCase(), '  我的新工程  ');
    assert.deepEqual(summary, { id: project.id, name: '我的新工程', createdAt: project.createdAt, duration: project.duration });
    assert.deepEqual(await read(project.id), { ...project, name: '我的新工程' });
    await projects.reveal(project.id);
    assert.deepEqual(revealed, [path.join(root, project.id, 'project.json')]);
    for (const name of ['', '   ', 'x'.repeat(121), 'invalid\0name']) await assert.rejects(projects.rename(project.id, name));
    assert.equal((await read(project.id)).name, '我的新工程');
    assert.equal((await projects.list())[0].name, '我的新工程');
  });
});

test('saving window-local whiteboard focus requires manifest version 4 and reloads its coordinates', async () => {
  await fixture(async ({ root, create, store }) => {
    const project = await create(), directory = path.join(root, project.id);
    project.whiteboard = { interfaceCapture: 'screen', events: [
      { t: .5, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 },
        windowBounds: { x: 0, y: 0, width: 1, height: 1 }, presentation: 'interface' } },
      { t: 1, action: { kind: 'focus', space: 'window', point: { x: .25, y: .75 } } },
    ] };
    await fs.writeFile(path.join(directory, 'project.json'), JSON.stringify({ version: 4, project, embeddedAudio: false }));
    const projects = await store(), loaded = await projects.load(project.id);
    await projects.save(loaded);
    const saved = JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8'));
    assert.equal(saved.version, 4);
    assert.deepEqual((await (await store()).load(project.id)).whiteboard?.events[1].action,
      { kind: 'focus', space: 'window', point: { x: .25, y: .75 } });
  });
});

test('demo recordings reserve manifest 6 while preserving released manifest 5 whiteboards and immutable ranges', async () => {
  await fixture(async ({ root, create, store }) => {
    for (const demo of [false, true]) {
      const project = await create(), directory = path.join(root, project.id);
      project.whiteboard = { events: [{ t: .5, action: { kind: 'layout', visible: true, passthrough: true,
        bounds: { x: 0, y: 0, width: 1, height: 1 }, presentation: 'canvas' } }] };
      if (demo) project.demoCapture = [{ start: 0, end: 1 }];
      await fs.writeFile(path.join(directory, 'project.json'), JSON.stringify({ version: 5, project, embeddedAudio: false }));
      const projects = await store(), loaded = await projects.load(project.id);
      loaded.demoCapture = undefined;
      await projects.save(loaded);
      const saved = JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8'));
      assert.equal(saved.version, demo ? 6 : 5);
      const reopened = await (await store()).load(project.id);
      assert.deepEqual(reopened.demoCapture, project.demoCapture);
      assert.deepEqual(reopened.whiteboard, project.whiteboard);
    }
  });
});

test('independent demo camera facts reserve manifest 10 and stay immutable across save/reopen', async () => {
  await fixture(async ({ root, create, store }) => {
    const project = await create(), projects = await store();
    project.demoCapture = [{ start: 0, end: .5 }, { start: .5, end: 1, camera: 'independent' }];
    await fs.writeFile(path.join(root, project.id, 'project.json'), JSON.stringify({ version: 10, project, embeddedAudio: false }));
    const submitted = structuredClone(await projects.load(project.id));
    submitted.demoCapture = [{ start: 0, end: 1 }];
    await projects.save(submitted);
    const saved = JSON.parse(await fs.readFile(path.join(root, project.id, 'project.json'), 'utf8'));
    assert.equal(saved.version, 10);
    assert.deepEqual((await (await store()).load(project.id)).demoCapture, project.demoCapture);
  });
});

test('new separate-canvas recordings reserve manifest 7 and persist their output authority on reopen', async () => {
  await fixture(async ({ root, create, store }) => {
    const project = await create(), projects = await store();
    project.whiteboard = { events: [], separateCanvas: true }; project.demoCapture = [{ start: 0, end: 1 }];
    await fs.writeFile(path.join(root, project.id, 'project.json'), JSON.stringify({ version: 7, project, embeddedAudio: false }));
    const submitted = structuredClone(await projects.load(project.id)); delete submitted.whiteboard!.separateCanvas;
    await projects.save(submitted);
    const saved = JSON.parse(await fs.readFile(path.join(root, project.id, 'project.json'), 'utf8'));
    assert.equal(saved.version, 7);
    assert.equal((await (await store()).load(project.id)).whiteboard?.separateCanvas, true);
  });
});

test('animated board events require manifest 8 and survive saving and reopening', async () => {
  await fixture(async ({ root, create, store }) => {
    const project = await create(), projects = await store();
    const shape = { kind: 'shape' as const, id: 'voice', shape: 'rectangle' as const,
      color: '#20242c', size: 3, x: 100, y: 100, width: 220, height: 120, text: '提出想法' };
    project.whiteboard = { separateCanvas: true, events: [{ t: 1, action: { kind: 'reveal', element: shape } }] };
    await fs.writeFile(path.join(root, project.id, 'project.json'), JSON.stringify({ version: 8, project, embeddedAudio: false }));
    await projects.save(await projects.load(project.id));
    const saved = JSON.parse(await fs.readFile(path.join(root, project.id, 'project.json'), 'utf8'));
    assert.equal(saved.version, 8);
    assert.deepEqual((await (await store()).load(project.id)).whiteboard, project.whiteboard);
  });
});

test('connector and spoken-text motion require manifest 9 and survive saving and reopening', async () => {
  await fixture(async ({ root, create, store }) => {
    const project = await create(), projects = await store();
    const node = { kind: 'shape' as const, id: 'voice', shape: 'rectangle' as const, color: '#20242c', size: 3,
      x: 100, y: 100, width: 220, height: 120, text: '提出想法' };
    const line = { kind: 'line' as const, id: 'link', color: '#20242c', size: 3, arrow: true,
      start: { x: 0, y: 100, shapeId: 'source' }, end: { x: 100, y: 100, shapeId: node.id } };
    project.whiteboard = { events: [
      { t: .5, action: { kind: 'connect-node', line, node, reveal: true } },
      { t: 1, action: { kind: 'replace', gesture: 'speech', element: { ...node, text: '补入文字' }, reveal: 'text' } },
    ] };
    await fs.writeFile(path.join(root, project.id, 'project.json'), JSON.stringify({ version: 9, project, embeddedAudio: false }));
    await projects.save(await projects.load(project.id));
    const saved = JSON.parse(await fs.readFile(path.join(root, project.id, 'project.json'), 'utf8'));
    assert.equal(saved.version, 9);
    assert.deepEqual((await (await store()).load(project.id)).whiteboard, project.whiteboard);
  });
});

test('queued and later autosaves retain a renamed title while preserving their actual edits', async () => {
  await fixture(async ({ create, read, store }) => {
    const project = await create(), projects = await store(), submitted = await projects.load(project.id);
    submitted.style.padding = 88;
    const saving = projects.save(submitted), renaming = projects.rename(project.id, 'Name from library');
    await Promise.all([saving, renaming]);
    submitted.audio.microphone = .4;
    await projects.save(submitted);
    assert.equal((await read(project.id)).name, 'Name from library');
    assert.equal((await read(project.id)).style.padding, 88); assert.equal((await read(project.id)).audio.microphone, .4);
    assert.equal(projects.edited(submitted).project.name, 'Name from library', 'An export also uses the authoritative title');
  });
});

test('deletion drains an accepted save, locks new work and prevents autosave or recovery resurrection', async () => {
  await fixture(async ({ root, recycled, create, store }) => {
    const project = await create(); let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const projects = await store({ trashItem: async directory => {
      const saved = JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8')).project;
      assert.equal(saved.style.padding, 77, 'Save accepted before delete must finish before trash');
      enter(); await gate;
      await fs.rename(directory, path.join(recycled, path.basename(directory)));
    } });
    const submitted = await projects.load(project.id); submitted.style.padding = 77;
    const saved = projects.save(submitted), listing = projects.list(), deletion = projects.deleteProjects([project.id]);
    await entered;
    try {
      await assert.rejects(projects.save(submitted), /删除|回收站/);
      await assert.rejects(projects.load(project.id.toUpperCase()), /删除|回收站/);
      await assert.rejects(projects.media(project.id, 'screen'), /删除|回收站/);
    } finally { release(); }
    await saved; await listing;
    assert.deepEqual(await deletion, { deletedIds: [project.id], failed: [] });
    await assert.rejects(projects.save(submitted), /删除|回收站/);
    assert.equal(await projects.recover(project.id), undefined);
    assert.deepEqual(await projects.list(), []);
    await assert.rejects(fs.stat(path.join(root, project.id)), { code: 'ENOENT' });
    assert.equal((await fs.stat(path.join(recycled, project.id, 'screen.mp4'))).isFile(), true);
  });
});

test('batch deletion reports independent failures and leaves failed or actively written projects intact', async () => {
  await fixture(async ({ root, recycled, create, store }) => {
    const good = await create('Good'), bad = await create('Trash unavailable'); let fail = true; const calls: string[] = [];
    const projects = await store({ trashItem: async directory => {
      const id = path.basename(directory); calls.push(id);
      if (id === bad.id && fail) throw new Error('回收站暂不可用');
      await fs.rename(directory, path.join(recycled, id));
    } });
    await projects.load(bad.id);
    const active = await projects.createDirectory();
    const result = await projects.deleteProjects([good.id, good.id.toUpperCase(), bad.id, active.id, '..']);
    assert.deepEqual(result.deletedIds, [good.id]);
    assert.deepEqual(result.failed.map(item => item.id), [bad.id, active.id, '..']);
    assert.match(result.failed[0].error, /回收站暂不可用/); assert.match(result.failed[1].error, /写入/);
    assert.deepEqual(calls, [good.id, bad.id]);
    assert.equal(projects.get(bad.id).project.name, bad.name);
    assert.equal((await fs.stat(path.join(root, bad.id))).isDirectory(), true);
    assert.equal((await fs.stat(active.directory)).isDirectory(), true);
    fail = false;
    assert.deepEqual(await projects.deleteProjects([bad.id]), { deletedIds: [bad.id], failed: [] });
    projects.endWrite(active.id);
  });
});

test('busy and malformed requests never invoke trash, including activity beginning during a queued delete', async () => {
  await fixture(async ({ create, store }) => {
    const project = await create(); let calls = 0;
    const projects = await store({ trashItem: async () => { calls++; } });
    for (const value of [null, [], [1], new Array(101).fill(project.id)]) await assert.rejects(projects.deleteProjects(value));
    assert.match((await projects.deleteProjects([project.id], () => '导出仍在进行')).failed[0].error, /导出/);
    let checks = 0;
    const result = await projects.deleteProjects([project.id], () => ++checks > 1 ? '录制已经开始' : undefined);
    assert.match(result.failed[0].error, /录制已经开始/); assert.equal(calls, 0);
    assert.equal((await projects.load(project.id)).name, project.name);
  });
});

test('successful project removal notifies cache maintenance, while failed trash operations do not', async () => {
  await fixture(async ({ create, store }) => {
    const first = await create(), second = await create(); let notifications = 0;
    const projects = await store({ onDeleted: () => { notifications++; } });
    assert.deepEqual((await projects.deleteProjects([first.id])).deletedIds, [first.id]);
    assert.equal(notifications, 1);
    const failing = await store({ onDeleted: () => { notifications++; }, trashItem: async () => { throw Error('trash failed'); } });
    assert.equal((await failing.deleteProjects([second.id])).failed.length, 1);
    assert.equal(notifications, 1);
  });
});


test('camera whiteboard reserves manifest 12 and reloads its opacity and transition without losing history', async () => {
  await fixture(async ({ root, create, store }) => {
    const project = await create(), directory = path.join(root, project.id);
    project.whiteboard = { events: [{ t: .5, action: { kind: 'layout', visible: true,
      bounds: { x: 0, y: 0, width: 1, height: 1 }, backdrop: 'camera', shade: .4,
      cameraTransition: { direction: 'enter', duration: 1.1, camera: { x: .7, y: .6, width: .2, height: .2 } } } }] };
    await fs.writeFile(path.join(directory, 'project.json'), JSON.stringify({ version: 12, project, embeddedAudio: false }));
    const projects = await store(), loaded = await projects.load(project.id); await projects.save(loaded);
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8')).version, 12);
    assert.deepEqual((await (await store()).load(project.id)).whiteboard, loaded.whiteboard);
  });
});

test('fresh-board resets reserve manifest 13 and retain the earlier board when the project reloads', async () => {
  await fixture(async ({ root, create, store }) => {
    const project = await create(), directory = path.join(root, project.id);
    project.whiteboard = { events: [
      { t: .1, action: { kind: 'text', id: 'old', text: '第一张白板', color: '#20242c', size: 32, x: 10, y: 10 } },
      { t: .4, action: { kind: 'reset' } },
    ] };
    await fs.writeFile(path.join(directory, 'project.json'), JSON.stringify({ version: 13, project, embeddedAudio: false }));
    const projects = await store(), loaded = await projects.load(project.id); await projects.save(loaded);
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8')).version, 13);
    assert.deepEqual((await (await store()).load(project.id)).whiteboard, project.whiteboard);
  });
});
