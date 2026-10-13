import { desktopCapturer } from 'electron';
import type { CaptureSource, MicrophoneDevice, NativeRecordingResult, Project, RecordingOptions, RecordingState } from '../../shared/types';
import { NativeClient } from './native-client';
import { ProjectStore } from './projects';
import { recordingOptions } from './validation';
import { CameraManager, type CameraAttachment } from './camera';
import { diagnostic } from './diagnostics';
import { isCameraTransientWarning } from './camera-health';
import { startRecordingSources } from './recording-start';
import { LiveRecordingControls } from './live-recording-controls';
import type { DesktopPreferences } from './desktop-preferences';
import { WhiteboardJournal } from './whiteboard/journal';
import { DemoJournal } from './demo/journal';
import { capturedDemoCamera } from './demo/camera-policy';
import { parseExcludedApplications } from './live/validation';

type NativeState = RecordingState & { warning?: string; warnings?: string[] };
interface ActiveRecording { id: string; directory: string; options: RecordingOptions }
export class RecordingController {
  state: NativeState = { status: 'idle' };
  readonly controls: LiveRecordingControls;
  readonly whiteboard = new WhiteboardJournal();
  prepareCapture?: (source: CaptureSource, options: RecordingOptions) => Promise<string[]>;
  demoOptions?: () => { captureOwnApp: boolean; ownAppVisible: boolean };
  private demoJournal = new DemoJournal();
  private demoJournalReady = false;
  private active?: ActiveRecording;
  private starting?: Promise<void>;
  private stopping?: Promise<Project>;
  private startedAt = 0;
  private attachingCamera?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private warnings: string[] = [];
  onState?: (state: NativeState) => void;
  onProject?: (project: Project) => void;
  constructor(private native: NativeClient, private projects: ProjectStore, private camera = new CameraManager(), preferences?: DesktopPreferences) {
    this.controls = new LiveRecordingControls(native, () => this.state, () => {
      if (this.controls.snapshot().microphoneEnabled) {
        this.warnings = this.warnings.filter(warning => !warning.startsWith('麦克风已停止，屏幕录制继续'));
        this.state = { ...this.state, warnings: [...this.warnings] };
      }
      this.onState?.(this.state);
    }, preferences);
    native.onAudioState = (state, warning) => {
      if (!this.active || this.state.status !== 'recording' || this.stopping) return;
      try { this.controls.audioState(state); }
      catch (error) { diagnostic('recording.audio-state', error); return; }
      this.addWarning(warning); this.update({ ...this.state, warnings: [...this.warnings] });
    };
    camera.onWarning = (id, warning) => {
      if (this.active?.options.cameraSessionId !== id || this.stopping) return;
      this.addWarning(warning);
      this.update({ ...this.state, warnings: [...this.warnings] });
    };
    camera.onRecovered = id => {
      if (this.active?.options.cameraSessionId !== id) return;
      this.warnings = this.warnings.filter(warning => !isCameraTransientWarning(warning));
      if (!this.stopping && this.state.status === 'recording') this.update({ ...this.state, warnings: [...this.warnings] });
    };
    native.onState = (value) => {
      const state = value as NativeState;
      const warningCount = this.warnings.length;
      for (const warning of [...(state.warnings ?? []), ...(state.warning ? [state.warning] : [])]) this.addWarning(warning);
      if (state.status !== 'error') {
        if (this.warnings.length !== warningCount && this.state.status === 'recording' && !this.stopping) {
          this.update({ ...this.state, warnings: [...this.warnings] });
        }
        return;
      }
      diagnostic('recording.native-state-error', state.error, { directory: this.active?.directory });
      this.addWarning(state.error ?? '录制模块出现错误');
      // Native must finish containers and audio before its process exits.
      if (this.starting || this.stopping) return;
      if (this.active) void this.stop().catch(() => {});
      else this.update({ status: 'error', error: state.error });
    };
  }
  private update(state: NativeState): void { this.state = state; this.onState?.(state); }
  private addWarning(warning: string): void { if (!this.warnings.includes(warning)) this.warnings.push(warning); }
  private clearTimer(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  isActive(): boolean { return Boolean(this.active || this.starting); }
  async attachCamera(value: unknown): Promise<void> {
    const active = this.active;
    if (!active || this.state.status !== 'recording' || this.stopping || this.attachingCamera)
      throw new Error('请等待当前设备操作完成');
    if (active.options.cameraSessionId) throw new Error('摄像头已在录制，请使用设备切换');
    if (typeof value !== 'string' || !this.camera.isPrepared(value)) throw new Error('摄像头未准备好');
    const attempt = (async () => {
      try {
        await this.camera.start(value, active.directory);
        if (this.active !== active || this.state.status !== 'recording' || this.stopping) throw new Error('录制已结束');
        active.options = { ...active.options, cameraSessionId: value };
        this.controls.attachCamera(value);
      } catch (error) { await this.camera.cancel(value).catch(() => {}); throw error; }
    })();
    this.attachingCamera = attempt;
    try { await attempt; } finally { this.attachingCamera = undefined; }
  }
  cameraInterrupted(id: unknown): void {
    if (typeof id !== 'string' || this.active?.options.cameraSessionId !== id || this.state.status !== 'recording' || this.stopping) return;
    const warning = '摄像头已停止，屏幕录制仍在继续；请检查设备连接或磁盘空间';
    if (this.warnings.includes(warning)) return;
    this.addWarning(warning);
    diagnostic('recording.camera-interrupted', warning, { id: this.active.id });
    this.controls.cameraUnavailable();
    this.update({ ...this.state, warnings: [...this.warnings] });
  }
  async sources(): Promise<CaptureSource[]> {
    // ScreenCaptureKit already owns source enumeration on macOS. Calling
    // Electron's thumbnail service in parallel can block the same WindowServer
    // session and make the native source request time out.
    const thumbnailsRequest = process.platform === 'darwin'
      ? Promise.resolve([] as Electron.DesktopCapturerSource[])
      : desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
    const results = await Promise.allSettled([this.native.request<CaptureSource[]>('sources'), thumbnailsRequest]);
    if (results[0].status === 'rejected') throw results[0].reason;
    const thumbnails = new Map<string, string>();
    if (results[1].status === 'fulfilled') for (const source of results[1].value) {
      const match = /^window:(\d+):/.exec(source.id);
      if (match && !source.thumbnail.isEmpty()) thumbnails.set(`window:${match[1]}`, source.thumbnail.toDataURL());
    }
    else diagnostic('capture-source-thumbnails', results[1].reason);
    return results[0].value.map((source) => source.kind === 'window' && thumbnails.has(source.id)
      ? { ...source, thumbnail: thumbnails.get(source.id) } : source);
  }
  async start(value: unknown): Promise<void> {
    if (this.active || this.starting || this.stopping) throw new Error('已有录制正在进行');
    const options = recordingOptions(value);
    this.controls.reset(options);
    this.warnings = [];
    this.update({ status: 'starting' });
    const attempt = this.begin(options);
    this.starting = attempt;
    try { await attempt; }
    finally {
      this.starting = undefined;
      if (this.state.status === 'error') this.onState?.(this.state);
    }
  }
  async setExcludedApplications(value: unknown): Promise<void> {
    const active = this.active;
    if (!active || this.state.status !== 'recording' || this.stopping)
      throw new Error('只有正在录制时可以调整排除应用');
    const excludedApplications = parseExcludedApplications(value);
    await this.native.request('recording-exclusions', { excludedApplications });
    if (this.active !== active || this.state.status !== 'recording' || this.stopping)
      throw new Error('录制已结束，本次选择未保存');
    active.options = { ...active.options, excludedApplications };
  }
  private async begin(options: RecordingOptions): Promise<void> {
    try {
      const sources = await this.sources();
      const source = sources.find((item) => item.id === options.sourceId);
      if (!source) throw new Error('录制来源已关闭，请重新选择');
      if (options.crop && (options.crop.x + options.crop.width > source.width || options.crop.y + options.crop.height > source.height)) {
        throw new Error('录制选区超出了来源边界');
      }
      const location = await this.projects.createDirectory();
      this.active = { ...location, options };
      // Demo captures all visible UI; normal intervals still replay the separate board.
      await this.whiteboard.reset(location.directory);
      if (options.microphone) this.controls.microphoneName(options, await this.native.request<MicrophoneDevice[]>('microphone-devices'));
      const excludeWindowHandles = await this.prepareCapture?.(source, options) ?? [];
      const demo = this.demoOptions?.();
      this.update({ status: 'starting' });
      const response = await startRecordingSources(this.native, this.camera, options, location.directory, excludeWindowHandles, process.platform, demo);
      // Native Windows capture requires an empty directory until startup succeeds.
      this.demoJournalReady = false;
      if (demo?.captureOwnApp) {
        await this.demoJournal.start(location.directory, demo.ownAppVisible, capturedDemoCamera(process.platform, response?.cameraIndependent));
        this.demoJournalReady = true;
      }
      this.startedAt = typeof response?.startedAtUnixMs === 'number' && Number.isFinite(response.startedAtUnixMs) ? response.startedAtUnixMs : Date.now();
      this.controls.start(this.startedAt);
      this.whiteboard.start(this.startedAt);
      await this.whiteboard.flush();
      for (const warning of response?.warnings ?? []) this.addWarning(warning);
      diagnostic('recording.started', undefined, { id: location.id, startedAtUnixMs: this.startedAt, camera: Boolean(options.cameraSessionId), warnings: this.warnings });
      if (!this.stopping) {
        this.update({ status: 'recording', elapsed: 0, startedAtUnixMs: this.startedAt, warnings: [...this.warnings] });
        this.timer = setInterval(() => this.update({ status: 'recording', elapsed: (Date.now() - this.startedAt) / 1000,
          startedAtUnixMs: this.startedAt, warnings: [...this.warnings] }), 1000);
      }
    } catch (error) {
      diagnostic('recording.start-failed', error, { directory: this.active?.directory });
      if (options.cameraSessionId) await this.camera.cancel(options.cameraSessionId).catch(() => {});
      await this.native.shutdownGracefully();
      if (this.active) this.projects.endWrite(this.active.id);
      this.active = undefined;
      this.update({ status: 'error', error: error instanceof Error ? error.message : '无法开始录制' });
      throw error;
    }
  }
  stop(): Promise<Project> {
    if (this.stopping) return this.stopping;
    if (!this.active && !this.starting) return Promise.reject(new Error('当前没有正在进行的录制'));
    const starting = this.starting;
    this.stopping = (async () => {
      if (starting) await starting;
      if (!this.active) throw new Error('录制尚未成功开始');
      return this.finishRecording(this.active);
    })().finally(() => {
      this.clearTimer(); this.active = undefined; this.stopping = undefined;
      this.onState?.(this.state);
    });
    return this.stopping;
  }
  async setDemoVisibility(visible: boolean): Promise<void> {
    if (!this.active || this.state.status !== 'recording' || this.stopping || !this.active.options.sourceId.startsWith('screen:'))
      throw new Error('演示录制已结束或尚未准备好');
    const previous = this.demoOptions?.().ownAppVisible ?? false;
    const response = await this.native.request<{ time: number; cameraIndependent?: boolean }>('recording-demo', { visible });
    try {
      if (!this.demoJournalReady) {
        await this.demoJournal.start(this.active.directory, false);
        this.demoJournalReady = true;
      }
      await this.demoJournal.set(response.time, visible, capturedDemoCamera(process.platform, response.cameraIndependent));
    }
    catch (error) {
      // The pixels changed, so retain that boundary even if the first disk write failed.
      if (this.state.status === 'recording') {
        const restored = await this.native.request<{ time: number; cameraIndependent?: boolean }>('recording-demo', { visible: previous });
        if (this.demoJournalReady) await this.demoJournal.set(restored.time, previous, capturedDemoCamera(process.platform, restored.cameraIndependent));
      }
      throw error;
    }
  }
  private async finishRecording(active: ActiveRecording): Promise<Project> {
    this.clearTimer(); this.update({ status: 'stopping', warnings: [...this.warnings] });
    await this.attachingCamera?.catch(() => {});
    try {
      if (!this.native.isRunning()) throw new Error('录制模块已退出，已有素材仍保留在工程目录');
      const result = await this.native.request<NativeRecordingResult & { warnings?: string[] }>('stop');
      for (const warning of result.warnings ?? []) this.addWarning(warning);
      let camera: CameraAttachment | undefined;
      if (active.options.cameraSessionId) {
        try {
          camera = await this.camera.stopAndAttach(active.options.cameraSessionId, active.directory, result.startedAtUnixMs ?? this.startedAt, result.duration);
          for (const warning of camera.warnings ?? []) this.addWarning(warning);
        }
        catch (error) {
          diagnostic('recording.camera-save-failed', error, { id: active.id });
          const presenter = this.controls.modeKeyframes(result.duration).some(frame => frame.mode === 'presenter');
          this.addWarning(`摄像头保存失败，屏幕录制已保留${presenter ? '，口播片段将显示空画面' : ''}：${error instanceof Error ? error.message : String(error)}`);
          await this.camera.cancel(active.options.cameraSessionId).catch(() => {});
        }
      }
      await this.whiteboard.flush();
      if (this.demoJournalReady) await this.demoJournal.flush();
      const project = await this.projects.acceptRecording(result, active.options, active.id, active.directory, camera,
        this.controls.keyframes(result.duration), this.controls.effectsKeyframes(result.duration), this.controls.modeKeyframes(result.duration), this.controls.snapshot().cameraPresenter);
      diagnostic('recording.saved', undefined, { id: project.id, duration: project.duration, camera: Boolean(project.media.camera), warnings: this.warnings });
      this.active = undefined;
      this.update({ status: 'idle', warnings: [...this.warnings], ...(this.warnings.length ? { error: this.warnings.join('\n') } : {}) });
      this.onProject?.(project);
      return project;
    } catch (error) {
      diagnostic('recording.stop-failed', error, { directory: active.directory });
      if (active.options.cameraSessionId) await this.camera.cancel(active.options.cameraSessionId).catch(() => {});
      await this.native.shutdownGracefully();
      this.projects.endWrite(active.id);
      try {
        const recovered = await this.projects.recover(active.id, active.options.cameraSessionId ? this.controls.modeKeyframes(Infinity) : [], this.controls.snapshot().cameraPresenter);
        if (recovered) {
          const warning = `录制停止时发生异常，已找回可用屏幕素材${recovered.camera && !recovered.media.camera ? '，口播片段已保留为空画面' : ''}：${error instanceof Error ? error.message : String(error)}`;
          this.update({ status: 'idle', warnings: [warning], error: warning });
          this.onProject?.(recovered);
          return recovered;
        }
      } catch (recoveryError) { diagnostic('recording.immediate-recovery-failed', recoveryError, { id: active.id }); }
      this.update({ status: 'error', error: `${error instanceof Error ? error.message : '保存录制失败'}。原始素材保留在 ${active.directory}` });
      throw error;
    }
  }
  dispose(): void { this.clearTimer(); this.native.dispose(); }
}
