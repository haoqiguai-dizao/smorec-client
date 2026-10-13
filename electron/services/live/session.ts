import { randomUUID } from 'node:crypto';
import type { LiveAudioState, LiveBoardFrame, LiveConfiguration, LiveFrame, LiveInput, LiveOptions, LiveState } from '../../../shared/live-types';
import type { CaptureSource, LiveRecordingState } from '../../../shared/types';
import { NativeClient } from '../native-client';
import { userPreferences } from '../user-preferences';
import { LiveFrameClient } from './frame-client';
import { VirtualCameraWriter, virtualCameraStatus } from './virtual-camera';
import { diagnostic } from '../diagnostics';
import { parseExcludedApplications, parseLiveOptions } from './validation';
import type { StreamConnection, StreamProfile } from '../../../shared/streaming';
import { pcmPeak, PreviewOutput } from './preview-output';
import { isLiveRuntimeIssue, LIVE_CAMERA_WARNING, LIVE_RUNTIME_ISSUES } from '../../../shared/live-issues';

export interface LiveOutput {
  start(width: number, height: number, fps: number): Promise<void>;
  write(pixels: unknown, time?: number): Promise<void>;
  audio?(data: Buffer, time: number): void;
  stop(): Promise<void>;
}

interface Options {
  idle(): boolean; sources(): Promise<CaptureSource[]>;
  deviceStatus?: typeof virtualCameraStatus;
  prepare(source: CaptureSource, options: LiveOptions): Promise<string[]>; restore(): Promise<void>;
  started?(timestamp: number): void | Promise<void>;
  whiteboard?(): LiveBoardFrame | undefined;
  camera(): LiveRecordingState; changed(state: LiveState): void;
  demoOptions?: () => { captureOwnApp: boolean; ownAppVisible: boolean };
  streamProfile?: (id: string) => Promise<StreamProfile>;
  streamOutput?: (profile: StreamProfile, changed: (state: StreamConnection) => void, failed: (error: Error) => void) => LiveOutput;
}
export class LiveSession {
  sourceId?: string;
  state: LiveState = { status: 'idle' };
  private native?: NativeClient;
  private frames?: LiveFrameClient;
  private output?: LiveOutput;
  private frameTime = 0;
  private events: LiveInput[] = [];
  private operation?: Promise<void>;
  private startOperation?: Promise<LiveConfiguration>;
  private watchdog?: ReturnType<typeof setInterval>;
  private lastOutput = 0;
  private frameCount = 0;
  private startupError?: Error;
  private prepared = false;
  private lastInputTime = 0;
  private updatingExclusions = false;
  private demoVisible = false;
  private demoCameraIndependent = false;
  private presentationUpdate?: Promise<void>;
  private presentationRevision = 0;
  private previewFallback = false;
  private configuration?: LiveConfiguration;
  private profile?: StreamProfile;
  private broadcastOperation?: Promise<void>;
  private retiring = new Set<Promise<void>>();
  private audioUpdate = false;
  constructor(private options: Options) {}
  active(): boolean { return ['starting', 'live', 'stopping'].includes(this.state.status); }
  cameraSettingsChanged(open: boolean): void {
    if (this.state.status !== 'live' || !!this.state.cameraSettingsOpen === open) return;
    this.publish({ ...this.state, cameraSettingsOpen: open });
  }
  private publish(state: LiveState): void {
    this.state = state;
    try { this.options.changed(state); } catch (error) { diagnostic('live.publish-failed', error); }
  }
  start(value: unknown): Promise<LiveConfiguration> {
    if (this.active() || this.startOperation || this.operation || !this.options.idle()) return Promise.reject(new Error('请先结束当前采集或导出'));
    this.startupError = undefined; this.prepared = false; this.lastInputTime = 0;
    this.publish({ status: 'starting' });
    const work = this.startCore(value);
    this.startOperation = work;
    return work.finally(() => { this.startOperation = undefined; });
  }
  private async startCore(value: unknown): Promise<LiveConfiguration> {
    try {
      const options = parseLiveOptions(value);
      this.previewFallback = options.preview === true;
      const direct = options.output === 'stream';
      const profile = direct ? await this.options.streamProfile?.(options.streamProfileId!) : undefined;
      this.profile = profile;
      if (direct && (!profile || !this.options.streamOutput)) throw new Error('直接推流组件未就绪');
      this.demoVisible = this.options.demoOptions?.().ownAppVisible ?? false;
      this.sourceId = options.sourceId;
      const source = (await this.options.sources()).find(item => item.id === options.sourceId);
      if (!source) throw new Error('直播来源已关闭，请重新选择');
      if (options.crop && (options.crop.x + options.crop.width > source.width
        || options.crop.y + options.crop.height > source.height)) throw new Error('直播区域无效');
      if (!direct && !options.preview) {
        const status = await (this.options.deviceStatus ?? virtualCameraStatus)();
        if (!status.installed) throw new Error('请先在直播设置中安装小录虚拟摄像头');
      }
      this.checkStarting();
      this.prepared = true;
      const handles = await this.options.prepare(source, options);
      this.checkStarting();
      const id = randomUUID(), pipeName = 'xiaolu-live-' + id;
      const short = profile?.resolution === '720p' ? 720 : 1080, long = short === 720 ? 1280 : 1920;
      const width = options.portrait ? short : long, height = options.portrait ? long : short, fps = profile?.fps ?? 30;
      const native = this.native = new NativeClient();
      native.onLiveInput = input => this.acceptInput(input);
      native.onLiveError = error => this.failed(new Error(error), 'native');
      native.onState = state => { if (state.status === 'error') this.failed(new Error(state.error), 'native'); };
      const captured = await native.request<{ width: number; height: number; startedAtUnixMs?: number; cameraIndependent?: boolean }>('live-start', {
        options: { sourceId: source.id, crop: options.crop, systemAudio: direct && options.systemAudio === true,
          microphone: direct && options.microphone === true, ...(direct && options.microphoneDeviceId ? { microphoneDeviceId: options.microphoneDeviceId } : {}), liveAudio: direct,
          fps, resolution: '1080p', excludeWindowHandles: handles, inputRecording: options.inputRecording,
          ...this.options.demoOptions?.(),
          ...(options.excludedApplications === undefined ? {} : { excludedApplications: options.excludedApplications }) }, pipeName,
      });
      this.demoCameraIndependent = process.platform === 'win32' || captured.cameraIndependent === true;
      this.checkStarting();
      if (![captured.width, captured.height].every(v => Number.isInteger(v) && v > 0 && v <= 1920)) throw new Error('直播采集尺寸无效');
      const frames = this.frames = new LiveFrameClient(captured.width, captured.height, direct);
      await frames.connect(pipeName);
      this.checkStarting();
      const output: LiveOutput = this.output = options.preview ? new PreviewOutput(width, height) : direct ? this.options.streamOutput!(profile!, connection => {
        if (this.output === output && this.active()) this.publish({ ...this.state, output: 'stream', connection });
      }, error => { if (this.output === output) this.failed(error); }) : new VirtualCameraWriter(error => this.failed(error));
      await output.start(width, height, fps);
      this.checkStarting();
      this.frameCount = 0; this.lastOutput = Date.now();
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastOutput > 8000) this.failed(new Error('直播画面已停止更新，请重新开始投屏'), 'output-watchdog');
      }, 2000);
      this.configuration = { id, width, height, fps, inputRecording: options.inputRecording,
        style: { ...userPreferences.read().style, aspect: options.portrait ? '9:16' : '16:9' } };
      await this.options.started?.(typeof captured.startedAtUnixMs === 'number' && Number.isFinite(captured.startedAtUnixMs) ? captured.startedAtUnixMs : Date.now());
      this.publish({ status: 'live', id, frames: 0, phase: options.preview ? 'preview' : 'broadcast',
        startedAtUnixMs: options.preview ? undefined : Date.now(), output: options.output ?? 'camera',
        audio: { system: direct && options.systemAudio === true, microphone: direct && options.microphone === true },
        ...(direct ? { output: 'stream' as const, connection: this.state.connection } : {}) });
      diagnostic('live.started', undefined, this.diagnosticContext());
      return this.configuration;
    } catch (error) {
      const reason = this.startupError ?? (error instanceof Error ? error : new Error(String(error)));
      await this.cleanup();
      await this.restore();
      this.publish({ status: 'error', error: reason.message });
      diagnostic('live.start-failed', reason);
      throw reason;
    }
  }
  private checkStarting(): void { if (this.startupError) throw this.startupError; }
  broadcast(id: unknown): Promise<void> {
    this.check(id);
    if (this.state.phase !== 'preview' || this.broadcastOperation || !this.configuration || this.frameCount < 1)
      return Promise.reject(new Error('请先等待预览画面就绪'));
    const configuration = this.configuration, direct = this.state.output === 'stream';
    const work = (async () => {
      if (!direct && !(await (this.options.deviceStatus ?? virtualCameraStatus)()).installed) throw new Error('请先安装小录虚拟摄像头');
      this.check(id);
      const failed = (error: Error) => { if (this.output === output) this.returnToPreview(output, error); };
      const output: LiveOutput = direct ? this.options.streamOutput!(this.profile!, connection => {
        if (this.output === output && this.state.status === 'live') this.publish({ ...this.state, connection });
      }, failed) : new VirtualCameraWriter(failed);
      this.output = output;
      this.publish({ ...this.state, phase: 'broadcast', startedAtUnixMs: Date.now(), error: undefined, connection: undefined });
      diagnostic('live.broadcast', undefined, this.diagnosticContext());
      try {
        await output.start(configuration.width, configuration.height, configuration.fps);
        this.check(id);
        if (this.output !== output) throw new Error(this.state.error ?? '直播连接已取消');
      } catch (error) {
        const reason = error instanceof Error ? error : new Error(String(error));
        if (this.output === output && this.state.status === 'live') this.returnToPreview(output, reason);
        await output.stop(); throw reason;
      }
    })();
    this.broadcastOperation = work;
    return work.finally(() => { this.broadcastOperation = undefined; });
  }
  private returnToPreview(output: LiveOutput, error: Error): void {
    const config = this.configuration;
    if (!config || this.state.status !== 'live' || this.output !== output) return;
    this.output = new PreviewOutput(config.width, config.height);
    diagnostic('live.output-failed', error, this.diagnosticContext());
    this.publish({ ...this.state, phase: 'preview', error: error.message });
    const retired = output.stop().catch(cause => diagnostic('live.output-stop-failed', cause)).finally(() => this.retiring.delete(retired));
    this.retiring.add(retired);
  }
  private acceptInput(input: LiveInput[]): void {
    if (this.updatingExclusions) return;
    for (const event of input) for (const time of [event?.cursor?.t, event?.activity?.t])
      if (typeof time === 'number' && Number.isFinite(time) && time >= 0) this.lastInputTime = Math.max(this.lastInputTime, time);
    if (this.events.length + input.length > 256) {
      // Drop the whole ambiguous batch. In particular, typing cannot cross a lost reset.
      this.events = [{ activity: { t: this.lastInputTime, kind: 'reset' } }];
      return;
    }
    this.events.push(...input);
  }
  private async restore(): Promise<void> {
    if (!this.prepared) return;
    this.prepared = false;
    try { await this.options.restore(); } catch (error) { diagnostic('live.restore-failed', error); }
  }
  private check(id: unknown): void {
    if (typeof id !== 'string' || this.state.status !== 'live' || id !== this.state.id) throw new Error('直播会话已结束');
  }
  async setAudio(id: unknown, channel: unknown, enabled: unknown): Promise<LiveAudioState> {
    this.check(id);
    if (this.state.output !== 'stream') throw new Error('声音请在直播伴侣中设置');
    if ((channel !== 'system' && channel !== 'microphone') || typeof enabled !== 'boolean') throw new Error('直播声音参数无效');
    if (this.audioUpdate) throw new Error('正在切换声音，请稍候');
    const current = this.state.audio;
    if (!current) throw new Error('直播声音尚未就绪');
    if (current[channel] === enabled) return current;
    this.audioUpdate = true;
    try {
      const next = { ...current, [channel]: enabled };
      const applied = await this.native!.request<LiveAudioState>('live-audio', { options: next });
      this.check(id);
      if (applied.system !== next.system || applied.microphone !== next.microphone) throw new Error('直播声音状态未确认，请重试');
      this.publish({ ...this.state, audio: applied });
      return applied;
    } finally { this.audioUpdate = false; }
  }
  async setWhiteboard(windowId: string | number, visible: boolean): Promise<void> {
    const id = this.state.id;
    this.check(id);
    if (this.updatingExclusions) throw new Error('正在更新画面，请稍候');
    this.updatingExclusions = true; this.presentationRevision++;
    const update = this.native!.request('live-whiteboard', { windowId, visible }).then(() => {
      this.check(id);
      this.events = [{ activity: { t: this.lastInputTime, kind: 'reset' } }];
    });
    this.presentationUpdate = update;
    try { await update; }
    finally { this.presentationUpdate = undefined; this.updatingExclusions = false; }
  }
  async setExcludedApplications(id: unknown, value: unknown): Promise<void> {
    this.check(id);
    const excludedApplications = parseExcludedApplications(value);
    if (this.updatingExclusions) throw new Error('正在更新排除应用，请稍候');
    this.updatingExclusions = true;
    this.events = [{ activity: { t: this.lastInputTime, kind: 'reset' } }];
    try {
      await this.native!.request('live-exclusions', { excludedApplications });
      this.check(id);
    } finally {
      this.events = [{ activity: { t: this.lastInputTime, kind: 'reset' } }];
      this.updatingExclusions = false;
    }
  }
  async setDemoVisibility(visible: boolean): Promise<void> {
    if (this.state.status === 'live' && !this.sourceId?.startsWith('screen:')) throw new Error('演示全部界面请使用屏幕或区域直播');
    if (this.state.status !== 'live' || this.updatingExclusions)
      throw new Error('投屏尚未准备好或正在更新画面');
    this.updatingExclusions = true;
    const id = this.state.id;
    this.presentationRevision++;
    const update = (async () => {
      const captured = await this.native!.request<{ cameraIndependent?: boolean }>('live-demo', { visible });
      this.check(id);
      this.demoVisible = visible;
      this.demoCameraIndependent = process.platform === 'win32' || captured.cameraIndependent === true;
      this.events = [{ activity: { t: this.lastInputTime, kind: 'reset' } }];
    })();
    this.presentationUpdate = update;
    try {
      await update;
    } finally { this.presentationUpdate = undefined; this.updatingExclusions = false; }
  }
  async pull(id: unknown): Promise<LiveFrame> {
    this.check(id);
    await this.presentationUpdate?.catch(() => {});
    this.check(id);
    const frames = this.frames!;
    const revision = this.presentationRevision;
    let time: number;
    try { time = await frames.pull(); }
    catch (error) { this.failed(error instanceof Error ? error : new Error(String(error)), 'capture-pipe'); throw error; }
    this.check(id);
    if (revision !== this.presentationRevision) return this.pull(id);
    this.frameTime = time;
    if (frames.audio) this.output?.audio?.(frames.audio, frames.audioTime);
    const input = this.events; this.events = [];
    const prefs = userPreferences.read();
    return { width: frames.width, height: frames.height, time, pixels: frames.pixels, input, audioLevel: pcmPeak(frames.audio),
      demoVisible: this.demoVisible,
      demoCameraIndependent: this.demoCameraIndependent,
      whiteboard: this.options.whiteboard?.(),
      camera: this.options.camera(), placement: { x: prefs.camera.x, y: prefs.camera.y }, shrinkOnZoom: prefs.cameraShrinkOnZoom };
  }
  async push(id: unknown, pixels: unknown): Promise<void> {
    this.check(id);
    const output = this.output!;
    try { await output.write(pixels, this.frameTime); }
    catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      if (this.previewFallback && !(output instanceof PreviewOutput)) this.returnToPreview(output, reason);
      else { this.failed(reason, 'output'); throw error; }
    }
    this.check(id);
    this.lastOutput = Date.now(); ++this.frameCount;
  }
  private diagnosticContext(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { status: this.state.status, phase: this.state.phase, output: this.state.output,
      frames: this.frameCount, outputIdleMs: this.lastOutput ? Math.max(0, Date.now() - this.lastOutput) : 0, ...extra };
  }
  report(id: unknown, issue: unknown): Promise<void> {
    this.check(id);
    if (!isLiveRuntimeIssue(issue)) throw new Error('直播状态报告无效');
    const reason = LIVE_RUNTIME_ISSUES[issue];
    diagnostic('live.runtime', undefined, this.diagnosticContext({ issue }));
    if (reason.fatal) {
      this.failed(new Error(reason.message), issue);
      return this.operation ?? Promise.resolve();
    }
    if (issue === 'camera-unavailable') {
      if (!this.state.error) this.publish({ ...this.state, error: LIVE_CAMERA_WARNING });
    }
    else if (this.state.error === LIVE_CAMERA_WARNING) this.publish({ ...this.state, error: undefined });
    return Promise.resolve();
  }
  private failed(error: Error, stage = 'output'): void {
    if (this.state.status === 'starting') {
      if (!this.startupError) diagnostic('live.failure', error, this.diagnosticContext({ stage }));
      this.startupError ??= error;
      this.frames?.close();
      this.native?.dispose();
    } else if (this.state.status === 'live') {
      diagnostic('live.failure', error, this.diagnosticContext({ stage }));
      void this.stop(error.message);
    }
  }
  stop(error?: string): Promise<void> {
    if (this.operation) return this.operation;
    if (this.state.status === 'starting') this.failed(new Error(error ?? '直播启动已取消'));
    const work = (async () => {
      if (this.startOperation) await this.startOperation.catch(() => undefined);
      if (!this.active()) return;
      diagnostic('live.stopped', undefined, this.diagnosticContext({ reason: error ? 'failure' : 'user' }));
      this.publish({ ...this.state, status: 'stopping' });
      await this.cleanup();
      this.publish(error ? { status: 'error', error } : { status: 'idle', frames: this.frameCount });
      await this.restore();
    })();
    this.operation = work;
    return work.finally(() => { this.operation = undefined; });
  }
  private async cleanup(): Promise<void> {
    clearInterval(this.watchdog); this.watchdog = undefined;
    this.frames?.close(); this.frames = undefined;
    const output = this.output; this.output = undefined;
    const native = this.native; this.native = undefined;
    if (native) { native.onLiveError = undefined; native.onState = undefined; native.onLiveInput = undefined; }
    const results = await Promise.allSettled([output?.stop(), native?.shutdownGracefully()]);
    for (const result of results) if (result.status === 'rejected') diagnostic('live.cleanup-failed', result.reason);
    await this.broadcastOperation?.catch(() => undefined);
    await Promise.allSettled([...this.retiring]);
    this.configuration = undefined; this.profile = undefined; this.previewFallback = false;
    this.events = [];
  }
}
