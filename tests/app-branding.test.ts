import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { APP_ID, APP_NAME, APP_PROTOCOL, LEGACY_USER_DATA_DIRECTORY, PROJECTS_DIRECTORY } from '../shared/brand';
import { DEFAULT_STYLE } from '../shared/constants';
import type { Project } from '../shared/types';
import { initializeApplicationBranding } from '../electron/services/app-branding';
import type { ProjectStore } from '../electron/services/projects';

function identityFixture(appData: string, overrides: Record<string, string> = {}) {
  let name = LEGACY_USER_DATA_DIRECTORY, modelId = '';
  const paths = new Map(Object.entries(overrides));
  const application = {
    getPath(key: string) {
      if (paths.has(key)) return paths.get(key)!;
      if (key === 'appData') return appData;
      if (key === 'sessionData' && paths.has('userData')) return paths.get('userData')!;
      return path.join(appData, name);
    },
    setPath(key: string, value: string) { paths.set(key, value); },
    setName(value: string) { name = value; },
    setAppUserModelId(value: string) { modelId = value; },
  };
  return { application, name: () => name, modelId: () => modelId };
}

test('display rename preserves both default and explicitly selected browser profile paths', () => {
  const base = path.resolve('output', 'branding-profile-fixture');
  const profiles: Record<string, string>[] = [{}, { userData: path.join(base, 'custom-user'), sessionData: path.join(base, 'custom-session') }];
  for (const overrides of profiles) {
    const fixture = identityFixture(base, overrides);
    const userData = fixture.application.getPath('userData'), sessionData = fixture.application.getPath('sessionData');
    initializeApplicationBranding(fixture.application, 'win32');
    assert.equal(fixture.name(), APP_NAME);
    assert.equal(fixture.application.getPath('userData'), userData);
    assert.equal(fixture.application.getPath('sessionData'), sessionData);
    assert.equal(fixture.modelId(), APP_ID);
    initializeApplicationBranding(fixture.application, 'win32');
    assert.equal(fixture.application.getPath('userData'), userData, 'Repeated initialization must not migrate profiles');
  }
  const nonWindows = identityFixture(base);
  initializeApplicationBranding(nonWindows.application, 'darwin');
  assert.equal(nonWindows.modelId(), '');
});

test('release metadata changes visible branding without changing the installer identity or profile defaults', async () => {
  const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
  assert.equal(manifest.name, LEGACY_USER_DATA_DIRECTORY);
  assert.equal(manifest.productName, undefined, 'The Electron bootstrap keeps the legacy profile name before branding initializes');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, manifest.version); assert.equal(lock.packages[''].version, manifest.version);
  assert.equal(manifest.build.appId, APP_ID);
  assert.equal(manifest.build.productName, APP_NAME);
  assert.equal(manifest.build.win.executableName, APP_NAME);
  assert.equal(manifest.build.directories.output, `release-v${manifest.version}`);
  assert.equal(manifest.build.win.icon, 'build/icon.ico');
  assert.equal(manifest.build.win.signAndEditExecutable, true, 'Windows resources must embed the product name and icon');
  assert.equal(manifest.build.win.signExecutable, false);
  assert.equal(APP_PROTOCOL, 'frameflow');
  assert.equal(PROJECTS_DIRECTORY, '小录');
  const preferenceSource = await fs.readFile('src/services/app-preferences.ts', 'utf8');
  assert.ok(preferenceSource.includes('frameflow.cameraEffects.v1'), 'The existing preference key stays readable at the unchanged app origin');
});

async function projectStoreAt(videos: string): Promise<typeof ProjectStore> {
  const bundled = await build({ entryPoints: [path.resolve('electron/services/projects.ts')], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
      name: 'branding-test-electron', setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'branding-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'branding-test' }, () => ({ loader: 'js',
          contents: `export const app = { getPath() { return ${JSON.stringify(videos)}; } }; export const dialog = {}; export const shell = { trashItem() { throw new Error('Branding test cannot delete projects'); } };`,
        }));
      },
    }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return (module.exports as { ProjectStore: typeof ProjectStore }).ProjectStore;
}

test('the branded app reads legacy projects and preserves profile preference bytes in place', async () => {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(output, 'branding-compatibility-'));
  try {
    const profile = path.join(fixture, 'profiles', LEGACY_USER_DATA_DIRECTORY), videos = path.join(fixture, 'videos');
    const id = '6f99111a-c9d8-4d01-96c0-dba13af54b20';
    const directory = path.join(videos, 'FrameFlow', id);
    await Promise.all([fs.mkdir(profile, { recursive: true }), fs.mkdir(directory, { recursive: true })]);
    const preferences = Buffer.from(JSON.stringify({ cameraEffects: { enabled: true, smoothing: .25, filter: 'warm' } }));
    const preferencePath = path.join(profile, 'Preferences'); await fs.writeFile(preferencePath, preferences);
    const oldProject: Project = { id, name: 'FrameFlow 旧工程', createdAt: '2026-09-01T00:00:00.000Z',
      duration: 5, width: 1280, height: 720, fps: 30, media: { screen: 'screen.mp4' }, cursor: [],
      clips: [{ id: 'old-clip', start: 0, end: 5 }], zooms: [], style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 } };
    const manifest = JSON.stringify({ version: 1, project: oldProject, embeddedAudio: false });
    await Promise.all([fs.writeFile(path.join(directory, 'project.json'), manifest), fs.writeFile(path.join(directory, 'screen.mp4'), 'Original screen fixture')]);
    const identity = identityFixture(path.dirname(profile)); initializeApplicationBranding(identity.application, 'win32');
    assert.equal(identity.application.getPath('userData'), profile);
    assert.deepEqual(await fs.readFile(path.join(identity.application.getPath('sessionData'), 'Preferences')), preferences);
    const Store = await projectStoreAt(videos), store = new Store();
    await store.initialize();
    assert.equal(store.root(), path.join(videos, '小录'));
    const loaded = await store.load(id);
    assert.equal(loaded.name, oldProject.name, 'Existing user project titles must not be renamed');
    assert.equal(loaded.media.screen, `frameflow://media/${id}/screen`);
    assert.equal((await store.list()).some(item => item.id === id), true);
    assert.equal(await fs.readFile(path.join(store.root(), id, 'project.json'), 'utf8'), manifest);
    const recording = await store.createDirectory();
    await Promise.all([fs.writeFile(path.join(recording.directory, 'screen.mp4'), 'New screen fixture'),
      fs.writeFile(path.join(recording.directory, 'cursor.json'), '[]')]);
    const accepted = await store.acceptRecording({ directory: recording.directory, duration: 5, width: 1280, height: 720,
      video: 'screen.mp4', cursor: 'cursor.json' }, { sourceId: 'screen:1', fps: 30, microphone: false, systemAudio: false }, recording.id, recording.directory);
    assert.ok(accepted.name.startsWith(`${APP_NAME}录制 `));
    assert.deepEqual(await fs.readFile(preferencePath), preferences);
  } finally {
    const resolved = await fs.realpath(fixture), relative = path.relative(output, resolved);
    assert.ok(relative.startsWith('branding-compatibility-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
