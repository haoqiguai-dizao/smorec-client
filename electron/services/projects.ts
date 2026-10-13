import { app, dialog, shell, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { APP_NAME, PROJECTS_DIRECTORY } from '../../shared/brand';
import { initializeProjectDirectory } from './project-directory';
import { generateAutoZooms } from '../../shared/timeline';
import type { BackgroundAsset, CameraEffectKeyframe, CameraLayoutKeyframe, CameraModeKeyframe, NativeRecordingResult, Project, ProjectDeletionResult, ProjectSummary, RecordingOptions, WebcamStyle } from '../../shared/types';
import { normalizeMedia, probeMedia } from './ffmpeg';
import { object, parseProject, string } from './validation';
import { readRecordedBoard } from './whiteboard/journal';
import { readDemoRanges } from './demo/journal';
import { imageAssets, imageFile, imageDirectory } from './whiteboard/images';
import type { CameraAttachment } from './camera';
import { recoverProject } from './recovery';
import { diagnostic } from './diagnostics';
import { userPreferences } from './user-preferences';
import { newProjectCanvasStyle, newRecordingCameraStyle, projectPreferenceChanges } from './project-preferences';
import { assertNoProjectLinks, managedProjectDirectory, managedProjectId, managedProjectRoot } from './project-paths';
import { ProjectOperations } from './project-operations';
import { backgroundFile, backgroundView, importBackgroundFile, MAX_PROJECT_BACKGROUNDS, validateBackgroundFiles } from './project-backgrounds';
import { CanvasBackgroundDefaults } from './canvas-background-defaults';

export interface StoredProject { project: Project; directory: string; embeddedAudio: boolean }
interface ProjectStoreOptions {
  canvasBackgrounds?: CanvasBackgroundDefaults;
  root?: () => string;
  trashItem?: (directory: string) => Promise<void>;
  reveal?: (file: string) => void;
  onDeleted?: () => void;
}
type MediaKey = keyof Project['media'];
const mediaKeys: MediaKey[] = ['screen', 'systemAudio', 'microphone', 'camera', 'whiteboard'];
function mediaName(value: string): string {
  if (path.basename(value) !== value || /[\\/:\0]/.test(value) || value === '.' || value === '..') {
    throw new Error('工程媒体文件名无效');
  }
  return value;
}
export async function safeMedia(directory: string, filename: string): Promise<string> {
  mediaName(filename);
  const [root, file] = await Promise.all([fs.realpath(directory), fs.realpath(path.join(directory, filename))]);
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('媒体文件必须位于工程目录内');
  if (!(await fs.stat(file)).isFile()) throw new Error('工程媒体不是有效文件');
  return file;
}
async function readJson(file: string): Promise<unknown> {
  if ((await fs.stat(file)).size > 128 * 1024 * 1024) throw new Error('工程文件过大');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
export class ProjectStore {
  private registry = new Map<string, StoredProject>();
  private pending = new Set<string>();
  private operations = new ProjectOperations();
  private listing?: Promise<ProjectSummary[]>;
  private defaultRoot?: string;
  private backgroundDefaultRetries = new Set<string>();
  onRecovered?: (name: string, warnings: string[]) => void;
  private canvasBackgrounds: CanvasBackgroundDefaults;
  constructor(private options: ProjectStoreOptions = {}) {
    this.canvasBackgrounds = options.canvasBackgrounds ?? new CanvasBackgroundDefaults(() => path.join(app.getPath('userData'), 'canvas-backgrounds'));
  }
  async initialize(): Promise<void> {
    if (this.options.root || this.defaultRoot) return;
    const result = await initializeProjectDirectory(app.getPath('videos'));
    this.defaultRoot = result.directory;
    if (result.status !== 'current') diagnostic('projects.directory', undefined, { status: result.status, reason: result.reason });
  }
  root(): string { return this.options.root?.() ?? this.defaultRoot ?? path.join(app.getPath('videos'), PROJECTS_DIRECTORY); }
  endWrite(id: string): void { this.pending.delete(managedProjectId(id)); }
  async createDirectory(): Promise<{ id: string; directory: string }> {
    const id = randomUUID();
    await fs.mkdir(this.root(), { recursive: true });
    const directory = path.join(await managedProjectRoot(this.root()), id);
    await fs.mkdir(directory);
    this.pending.add(id);
    return { id, directory };
  }
  view(stored: StoredProject): Project {
    const media: Project['media'] = { screen: '' };
    for (const key of mediaKeys) if (stored.project.media[key]) media[key] = `frameflow://media/${stored.project.id}/${key}`;
    if (stored.embeddedAudio && !stored.project.media.systemAudio) media.systemAudio = media.screen;
    return { ...stored.project, media, ...(stored.project.backgrounds ? {
      backgrounds: stored.project.backgrounds.map(asset => backgroundView(stored.project.id, asset)),
    } : {}) };
  }
  get(id: string): StoredProject {
    const key = managedProjectId(id); this.operations.assertAvailable(key);
    return this.lookup(key);
  }
  private lookup(id: string): StoredProject {
    const stored = this.registry.get(id);
    if (!stored) throw new Error('请先打开这个工程');
    return stored;
  }
  async media(id: string, key: string): Promise<string> {
    if (!mediaKeys.includes(key as MediaKey)) throw new Error('媒体类型无效');
    const stored = this.get(id);
    const filename = stored.project.media[key as MediaKey];
    if (!filename) throw new Error('这个工程没有该音轨');
    return safeMedia(stored.directory, filename);
  }
  async background(id: string, assetId: string): Promise<string> {
    const stored = this.get(id), asset = stored.project.backgrounds?.find(item => item.id === assetId);
    if (!asset) throw new Error('背景图片尚未注册到这个工程');
    return backgroundFile(stored.directory, asset);
  }
  async boardImage(id: string, assetId: string): Promise<string> {
    const stored = this.get(id);
    if (!imageAssets(stored.project.whiteboard).includes(assetId)) throw new Error('白板图片尚未注册到工程');
    return imageFile(stored.directory, assetId);
  }
  async importBackground(value: unknown, window: BrowserWindow): Promise<BackgroundAsset | null> {
    const id = managedProjectId(value);
    this.get(id);
    const choice = await dialog.showOpenDialog(window, { title: '选择背景图片', properties: ['openFile'],
      filters: [{ name: '背景图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    return this.operations.run(id, async () => {
      const previous = this.lookup(id), assets = previous.project.backgrounds ?? [];
      if (assets.length >= MAX_PROJECT_BACKGROUNDS) throw new Error('每个工程最多添加 32 张背景图片');
      const directory = await managedProjectDirectory(this.root(), id);
      if (path.resolve(directory).toLowerCase() !== path.resolve(previous.directory).toLowerCase()) throw new Error('工程目录已经变化');
      const asset = await importBackgroundFile(directory, choice.filePaths[0]);
      const stored = { ...previous, project: { ...previous.project, backgrounds: [...assets, asset] } };
      try { await this.persist(stored); }
      catch (error) { await fs.rm(path.join(directory, asset.src), { force: true }).catch(() => {}); throw error; }
      this.registry.set(id, stored);
      return backgroundView(id, asset);
    });
  }
  private async persist(stored: StoredProject): Promise<void> {
    const directory = await managedProjectDirectory(this.root(), stored.project.id);
    if (path.resolve(directory).toLowerCase() !== path.resolve(stored.directory).toLowerCase()) throw new Error('工程目录已变化，无法保存');
    const temporary = path.join(stored.directory, `project.${randomUUID()}.tmp`);
    try {
      // Older clients must refuse interface recordings rather than silently discard their video track.
      const board = stored.project.whiteboard;
      let version = stored.project.media.whiteboard ? 2 : 1;
      if (board?.interfaceCapture === 'screen' || board?.events.some(event => event.action.kind === 'viewport')) version = 3;
      if (board?.events.some(event => event.action.kind === 'focus' && event.action.space === 'window')) version = 4;
      if (board?.events.some(event => {
        const action = event.action;
        const element = action.kind === 'replace' ? action.element : action.kind === 'connect-node' ? action.node : action;
        return element.kind === 'shape' && element.shape === 'text' || action.kind === 'layout' && action.passthrough;
      })) version = 5;
      if (stored.project.demoCapture?.length) version = 6;
      if (board?.separateCanvas) version = 7;
      if (board?.events.some(event => event.action.kind === 'reveal')) version = 8;
      if (board?.events.some(({ action }) => action.kind === 'connect-node' && action.reveal
        || action.kind === 'replace' && action.reveal === 'text')) version = 9;
      if (stored.project.demoCapture?.some(range => range.camera === 'independent')) version = 10;
      if (stored.project.style.background.startsWith('asset:')) version = 11;
      if (board?.events.some(({ action }) => action.kind === 'layout'
        && (action.backdrop === 'camera' || action.cameraTransition))) version = 12;
      if (board?.events.some(({ action }) => action.kind === 'reset')) version = 13;
      await fs.writeFile(temporary, JSON.stringify({ version,
        project: stored.project, embeddedAudio: stored.embeddedAudio }), { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temporary, path.join(stored.directory, 'project.json'));
      this.pending.delete(stored.project.id);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  private unavailableCamera(modes: CameraModeKeyframe[], duration: number): WebcamStyle | undefined {
    const frames = modes.filter(frame => frame.t <= duration).map(frame => ({ ...frame }));
    if (!frames.some(frame => frame.mode === 'presenter')) return;
    // No camera media exists to synchronize. Offset zero is an unused placeholder.
    return { ...newRecordingCameraStyle(userPreferences.read(), 0), enabled: false,
      mode: frames[0].mode, modeKeyframes: frames, useRecordedMode: true };
  }
  async acceptRecording(result: NativeRecordingResult, options: RecordingOptions, id: string, directory: string,
    camera?: CameraAttachment, cameraLayout: CameraLayoutKeyframe[] = [], cameraEffects: CameraEffectKeyframe[] = [],
    cameraModes: CameraModeKeyframe[] = [], presenter?: import('../../shared/presenter').PresenterSettings): Promise<Project> {
    if (path.resolve(result.directory) !== path.resolve(directory)) throw new Error('录制输出目录不匹配');
    const cursorFile = await safeMedia(directory, result.cursor);
    const cursor = await readJson(cursorFile);
    const inputActivity = result.inputActivity === undefined ? undefined
      : await readJson(await safeMedia(directory, result.inputActivity));
    const preferences = userPreferences.read();
    const initialMode = cameraModes[0]?.mode ?? preferences.cameraMode;
    const cameraStyle = camera ? newRecordingCameraStyle(preferences, camera.offset)
      : options.cameraSessionId ? this.unavailableCamera(cameraModes, result.duration) : undefined;
    const includesPresenter = Boolean(cameraStyle && (cameraModes.length ? cameraModes.some(frame => frame.mode === 'presenter') : initialMode === 'presenter'));
    const whiteboard = await readRecordedBoard(directory, result.duration);
    for (const asset of imageAssets(whiteboard)) await imageFile(directory, asset);
    const project = parseProject({
      id, name: `${APP_NAME}录制 ${new Date().toLocaleString('zh-CN', { hour12: false })}`, createdAt: new Date().toISOString(),
      whiteboard,
      demoCapture: await readDemoRanges(directory, result.duration),
      duration: result.duration, width: result.width, height: result.height, fps: options.fps,
      media: { screen: mediaName(result.video),
        ...(whiteboard?.video ? { whiteboard: 'whiteboard.mp4' } : {}),
        ...(result.systemAudio ? { systemAudio: mediaName(result.systemAudio) } : {}),
        ...(result.microphone ? { microphone: mediaName(result.microphone) } : {}),
        ...(camera ? { camera: mediaName(camera.filename) } : {}) },
      ...(cameraStyle ? { camera: { ...cameraStyle,
        ...(presenter ? { presenterCrop: presenter.crop } : {}),
        mode: initialMode, ...(cameraModes.length ? { modeKeyframes: cameraModes, useRecordedMode: true } : {}),
        ...(cameraEffects.length ? { effects: cameraEffects[0].effects, effectKeyframes: cameraEffects, useRecordedEffects: true }
          : options.cameraEffects ? { effects: options.cameraEffects } : {}),
        ...(cameraLayout.some(frame => frame.zoom !== undefined) ? { zoom: cameraLayout[0].zoom ?? 1 } : {}),
        ...(cameraLayout.length ? { keyframes: cameraLayout, useRecordedLayout: true, placement: {
          x: cameraLayout[0].x, y: cameraLayout[0].y } } : {}) } } : {}),
      cursor, ...(inputActivity === undefined ? {} : { inputActivity }),
      clips: [{ id: randomUUID(), start: 0, end: result.duration }], zooms: [],
      style: newProjectCanvasStyle(preferences, { presenter: includesPresenter, presenterAspect: presenter?.aspect }),
      audio: { ...preferences.audio, ...(options.microphone && options.microphoneEffects ? { microphoneEffects: options.microphoneEffects } : {}) },
    });
    for (const key of mediaKeys) if (project.media[key]) await safeMedia(directory, project.media[key]!);
    project.zooms = generateAutoZooms(project.cursor, project.duration, project.inputActivity, project);
    await this.canvasBackgrounds.apply(project, directory).catch(error => diagnostic('background.default.failed', error));
    const stored = { project, directory, embeddedAudio: false };
    await this.persist(stored);
    this.registry.set(id, stored);
    return this.view(stored);
  }
  private async readStored(file: string): Promise<StoredProject> {
    const directory = path.dirname(file);
    const manifest = object(await readJson(await safeMedia(directory, path.basename(file))));
    if (typeof manifest.version !== 'number' || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].includes(manifest.version))
      throw new Error('此工程版本不受支持');
    const project = parseProject(manifest.project);
    project.id = managedProjectId(project.id);
    for (const key of mediaKeys) if (project.media[key]) await safeMedia(directory, project.media[key]!);
    await validateBackgroundFiles(directory, project.backgrounds);
    for (const asset of imageAssets(project.whiteboard)) await imageFile(directory, asset);
    return { project, directory, embeddedAudio: manifest.embeddedAudio === true };
  }
  async load(value: unknown): Promise<Project> {
    const id = managedProjectId(value);
    return this.operations.run(id, async () => {
      const stored = await this.readManaged(id);
      this.registry.set(id, stored);
      return this.view(stored);
    });
  }
  private async readManaged(id: string): Promise<StoredProject> {
    const directory = await managedProjectDirectory(this.root(), id);
    const stored = await this.readStored(path.join(directory, 'project.json'));
    if (stored.project.id !== id) throw new Error('工程文件标识与目录不匹配');
    return stored;
  }
  list(): Promise<ProjectSummary[]> {
    if (!this.listing) this.listing = this.readList().finally(() => { this.listing = undefined; });
    return this.listing;
  }
  async recover(value: string, cameraModes: CameraModeKeyframe[] = [], presenter?: import('../../shared/presenter').PresenterSettings): Promise<Project | undefined> {
    const id = managedProjectId(value);
    if (this.pending.has(id) || this.operations.unavailable(id)) return undefined;
    return this.operations.run(id, async () => {
      const directory = await managedProjectDirectory(this.root(), id);
      const recovered = await recoverProject(directory, id, () => newProjectCanvasStyle(userPreferences.read()));
      if (!recovered) return undefined;
      recovered.project.whiteboard = await readRecordedBoard(directory, recovered.project.duration);
      recovered.project.demoCapture = await readDemoRanges(directory, recovered.project.duration);
      if (recovered.project.whiteboard?.video) {
        await safeMedia(directory, 'whiteboard.mp4');
        recovered.project.media.whiteboard = 'whiteboard.mp4';
      }
      for (const asset of imageAssets(recovered.project.whiteboard)) await imageFile(directory, asset);
      recovered.project.zooms = generateAutoZooms(recovered.project.cursor, recovered.project.duration,
        recovered.project.inputActivity, recovered.project);
      const camera = this.unavailableCamera(cameraModes, recovered.project.duration);
      const project = camera ? parseProject({ ...recovered.project, camera: { ...camera, ...(presenter ? { presenterCrop: presenter.crop } : {}) },
        style: { ...recovered.project.style, aspect: presenter?.aspect ?? '16:9' } }) : recovered.project;
      const stored = { project, directory, embeddedAudio: false };
      await this.persist(stored);
      this.registry.set(id, stored);
      this.onRecovered?.(recovered.project.name, recovered.warnings);
      return this.view(stored);
    });
  }
  private async readList(): Promise<ProjectSummary[]> {
    await fs.mkdir(this.root(), { recursive: true });
    await managedProjectRoot(this.root());
    const entries = await fs.readdir(this.root(), { withFileTypes: true });
    const summaries: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || this.pending.has(entry.name)) continue;
      try {
        const id = managedProjectId(entry.name);
        if (this.operations.unavailable(id)) continue;
        try {
          await this.recover(entry.name);
        } catch (error) { diagnostic('recovery.failed', error, { id: entry.name }); }
        if (this.operations.unavailable(id)) continue;
        const directory = await managedProjectDirectory(this.root(), id);
        const raw = object(await readJson(await safeMedia(directory, 'project.json')));
        const p = object(raw.project);
        if (p.id !== entry.name || typeof p.name !== 'string' || typeof p.createdAt !== 'string' || typeof p.duration !== 'number') continue;
        summaries.push({ id: entry.name, name: p.name, createdAt: p.createdAt, duration: p.duration });
      } catch { /* Incomplete recordings are retained for recovery, not listed as valid projects. */ }
    }
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }
  edited(value: unknown): StoredProject {
    const raw = object(value), stored = this.get(managedProjectId(raw.id));
    const submitted = parseProject({ ...raw, backgrounds: stored.project.backgrounds });
    return this.applyEdits(stored, submitted);
  }
  private applyEdits(stored: StoredProject, submitted: Project): StoredProject {
    // Names have a dedicated operation; an older autosave snapshot cannot undo a rename.
    const project: Project = { ...stored.project, clips: submitted.clips,
      zooms: submitted.zooms, style: submitted.style, audio: submitted.audio };
    if (submitted.compositions === undefined) delete project.compositions;
    else project.compositions = submitted.compositions;
    if (stored.project.camera && submitted.camera) project.camera = { ...submitted.camera, offset: stored.project.camera.offset };
    // Validate edits against the trusted original duration, never a renderer-supplied duration.
    return { ...stored, project: parseProject(project) };
  }
  async save(value: unknown): Promise<void> {
    const raw = object(value), id = managedProjectId(raw.id);
    return this.operations.run(id, async () => {
      const submitted = parseProject({ ...raw, backgrounds: this.lookup(id).project.backgrounds });
      const previous = this.lookup(id), stored = this.applyEdits(previous, submitted);
      await this.persist(stored);
      this.registry.set(id, stored);
      const preferenceChanges = projectPreferenceChanges(previous.project, stored.project);
      if (Object.keys(preferenceChanges).length) userPreferences.update(preferenceChanges);
      // Saving an unchanged old project must not replace the user's latest background choice.
      if (previous.project.style.background !== stored.project.style.background || this.backgroundDefaultRetries.has(id)) {
        this.backgroundDefaultRetries.add(id);
        await this.canvasBackgrounds.remember(stored.project, stored.directory);
        this.backgroundDefaultRetries.delete(id);
      }
    });
  }
  async rename(value: unknown, nameValue: unknown): Promise<ProjectSummary> {
    const id = managedProjectId(value), name = string(nameValue, 120).trim();
    if ([...name].some(character => character.charCodeAt(0) < 32)) throw new Error('工程名称不能包含控制字符');
    return this.operations.run(id, async () => {
      if (this.pending.has(id)) throw new Error('工程仍在写入，请稍后重命名');
      const previous = await this.readManaged(id), stored = { ...previous, project: { ...previous.project, name } };
      await this.persist(stored); this.registry.set(id, stored);
      const { createdAt, duration } = stored.project;
      return { id, name, createdAt, duration };
    });
  }
  async reveal(value: unknown): Promise<void> {
    const id = managedProjectId(value);
    return this.operations.run(id, async () => {
      const stored = await this.readManaged(id);
      (this.options.reveal ?? shell.showItemInFolder)(path.join(stored.directory, 'project.json'));
    });
  }
  async deleteProjects(value: unknown, busy: () => string | undefined = () => undefined): Promise<ProjectDeletionResult> {
    if (!Array.isArray(value) || !value.length || value.length > 100 || value.some(id => typeof id !== 'string')) throw new Error('一次请选择 1 到 100 个工程');
    const result: ProjectDeletionResult = { deletedIds: [], failed: [] };
    for (const requested of new Set(value.map(id => id.toLowerCase()))) {
      try {
        const id = managedProjectId(requested), reason = busy();
        if (reason) throw new Error(reason);
        if (this.pending.has(id)) throw new Error('工程仍在录制或写入，请完成后再删除');
        await this.operations.remove(id, async () => {
          await this.listing?.catch(() => {});
          const reason = busy(); if (reason) throw new Error(reason);
          if (this.pending.has(id)) throw new Error('工程仍在写入，请稍后删除');
          const stored = await this.readManaged(id);
          await assertNoProjectLinks(stored.directory);
          const directory = await managedProjectDirectory(this.root(), id);
          const latestReason = busy(); if (latestReason) throw new Error(latestReason);
          await (this.options.trashItem ?? shell.trashItem)(directory);
          this.registry.delete(id); this.pending.delete(id);
        });
        result.deletedIds.push(id);
        this.options.onDeleted?.();
      } catch (error) { result.failed.push({ id: requested.slice(0, 120), error: error instanceof Error ? error.message : '无法将工程移入回收站' }); }
    }
    return result;
  }
  async importVideo(window: BrowserWindow): Promise<Project | null> {
    const choice = await dialog.showOpenDialog(window, { title: '导入视频', properties: ['openFile'], defaultPath: userPreferences.existingDirectory('importDirectory'),
      filters: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const source = choice.filePaths[0];
    userPreferences.update({ importDirectory: path.dirname(source) });
    const info = await probeMedia(source);
    const { id, directory } = await this.createDirectory();
    try {
    const filename = info.browserCompatible ? `screen${path.extname(source).toLowerCase()}` : 'screen.mp4';
    if (info.browserCompatible) await fs.copyFile(source, path.join(directory, filename));
    else {
      const original = `original${path.extname(source).toLowerCase()}`;
      await fs.copyFile(source, path.join(directory, original));
      await normalizeMedia(path.join(directory, original), path.join(directory, filename));
    }
    const normalized = info.browserCompatible ? info : await probeMedia(path.join(directory, filename));
    const project = parseProject({
      id, name: path.basename(source, path.extname(source)).slice(0, 120), createdAt: new Date().toISOString(),
      ...normalized, fps: 30, media: { screen: filename }, cursor: [],
      clips: [{ id: randomUUID(), start: 0, end: normalized.duration }], zooms: [],
      style: newProjectCanvasStyle(userPreferences.read(), { imported: true }), audio: userPreferences.read().audio,
    });
    await this.canvasBackgrounds.apply(project, directory).catch(error => diagnostic('background.default.failed', error));
    const stored = { project, directory, embeddedAudio: info.hasAudio };
    await this.persist(stored);
    this.registry.set(id, stored);
    return this.view(stored);
    } finally { this.endWrite(id); }
  }
  async open(window: BrowserWindow): Promise<Project | null> {
    const choice = await dialog.showOpenDialog(window, { title: `打开${APP_NAME}工程`, properties: ['openFile'],
      filters: [{ name: `${APP_NAME}工程`, extensions: ['json'] }] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const original = await this.readStored(choice.filePaths[0]);
    const home = path.join(this.root(), original.project.id);
    if (path.resolve(home).toLowerCase() === path.resolve(original.directory).toLowerCase()) return this.load(original.project.id);
    const { id, directory } = await this.createDirectory();
    try {
    for (const key of mediaKeys) {
      const filename = original.project.media[key];
      if (filename) await fs.copyFile(await safeMedia(original.directory, filename), path.join(directory, filename));
    }
    for (const asset of original.project.backgrounds ?? [])
      await fs.copyFile(await backgroundFile(original.directory, asset), path.join(directory, asset.src), fs.constants.COPYFILE_EXCL);
    if (imageAssets(original.project.whiteboard).length) await fs.mkdir(path.join(directory, imageDirectory));
    for (const asset of imageAssets(original.project.whiteboard))
      await fs.copyFile(await imageFile(original.directory, asset), path.join(directory, imageDirectory, `${asset}.png`), fs.constants.COPYFILE_EXCL);
    const stored = { ...original, directory, project: { ...original.project, id } };
    await this.persist(stored);
    this.registry.set(id, stored);
    return this.view(stored);
    } finally { this.endWrite(id); }
  }
}
