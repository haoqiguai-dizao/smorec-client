import { CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX } from '../../shared/camera-zoom';
import { DEFAULT_PRESENTER, parsePresenterSettings } from '../../shared/presenter';
import type { CameraEffectKeyframe, CameraEffects, CameraLayoutKeyframe, CameraMode, CameraModeKeyframe, LiveRecordingState, MicrophoneDevice, RecordingControlAction, RecordingOptions, RecordingState } from '../../shared/types';
import { ORIGINAL_CAMERA_EFFECTS } from '../../shared/camera-effects';
import { isCameraShape, type CameraShape } from '../../shared/camera-shapes';
import type { NativeClient } from './native-client';
import { parseCameraEffects, parseCameraEffectsPatch } from './validation';
import type { DesktopPreferences } from './desktop-preferences';

export class LiveRecordingControls {
  private settings = this.defaults();
  private layout: Omit<CameraLayoutKeyframe, 't'> = this.defaultLayout();
  private frames: CameraLayoutKeyframe[] = [];
  private effectFrames: CameraEffectKeyframe[] = [];
  private modeFrames: CameraModeKeyframe[] = [];
  private startedAt?: number;
  private audioChange = Promise.resolve();
  constructor(private native: NativeClient, private recordingState: () => RecordingState, private changed: () => void, private preferences?: DesktopPreferences) {}
  private defaultLayout(): Omit<CameraLayoutKeyframe, 't'> {
    return this.preferences?.read().camera ?? { x: 0.85, y: 0.8, size: 0.22, shape: 'circle', mirror: true, visible: true };
  }
  private defaults() {
    return { cameraSessionId: undefined as string | undefined, cameraPreviewing: false, countdown: undefined as number | undefined,
      cameraPresenter: structuredClone(DEFAULT_PRESENTER),
      cameraAvailable: false, cameraVisible: false, cameraMode: 'overlay' as CameraMode, cameraShape: 'circle' as CameraShape, cameraSize: 0.22,
      cameraMirror: true, cameraZoom: CAMERA_ZOOM_MIN, cameraEffects: { ...ORIGINAL_CAMERA_EFFECTS }, microphoneEnabled: false, microphoneMuted: false, microphoneDeviceId: '', microphoneName: '系统默认麦克风',
      systemAudioEnabled: false, systemAudioMuted: false };
  }
  reset(options: RecordingOptions): void {
    const presenter = this.settings.cameraPreviewing && this.settings.cameraSessionId === options.cameraSessionId
      ? this.settings.cameraPresenter : this.preferences?.read().presenter ?? DEFAULT_PRESENTER;
    const cameraMode = this.settings.cameraPreviewing && this.settings.cameraSessionId === options.cameraSessionId
      ? this.settings.cameraMode : this.preferences?.read().cameraMode ?? 'overlay';
    this.startedAt = undefined; this.frames = []; this.effectFrames = []; this.modeFrames = []; this.layout = this.defaultLayout();
    if (!options.cameraSessionId) this.layout.visible = false;
    this.settings = { ...this.defaults(), cameraSessionId: options.cameraSessionId,
      cameraAvailable: Boolean(options.cameraSessionId), cameraVisible: Boolean(options.cameraSessionId) && this.layout.visible,
      cameraMode, cameraPresenter: structuredClone(presenter),
      cameraZoom: this.layout.zoom ?? CAMERA_ZOOM_MIN, cameraShape: this.layout.shape, cameraSize: this.layout.size, cameraMirror: this.layout.mirror,
      cameraEffects: parseCameraEffects(options.cameraEffects ?? ORIGINAL_CAMERA_EFFECTS),
      microphoneEnabled: options.microphone, microphoneDeviceId: options.microphoneDeviceId ?? '', systemAudioEnabled: options.systemAudio };
  }
  preparePreview(sessionId: string, effects?: CameraEffects): void {
    if (!['idle', 'error'].includes(this.recordingState().status)) return;
    if (this.settings.cameraSessionId !== sessionId || !this.settings.cameraPreviewing) {
      this.reset({ sourceId: '', fps: 30, microphone: false, systemAudio: false, cameraSessionId: sessionId, cameraEffects: effects });
      this.layout.visible = true;
    } else if (effects) this.settings.cameraEffects = parseCameraEffects(effects);
    this.settings.cameraPreviewing = true;
    this.settings.cameraAvailable = true; this.settings.cameraVisible = true;
    this.changed();
  }
  endPreview(sessionId?: string): void {
    if (!this.settings.cameraPreviewing || sessionId && this.settings.cameraSessionId !== sessionId) return;
    this.settings.cameraPreviewing = false; this.settings.cameraSessionId = undefined; this.settings.countdown = undefined;
    this.settings.cameraAvailable = false; this.settings.cameraVisible = false;
    this.changed();
  }
  previewCountdown(sessionId: string, value: unknown): void {
    if (value !== null && value !== 1 && value !== 2 && value !== 3) throw new Error('录制倒计时无效');
    // Late countdown/cancel messages must not affect another camera or an active recording.
    if (!this.settings.cameraPreviewing || this.settings.cameraSessionId !== sessionId
      || !['idle', 'error'].includes(this.recordingState().status)) return;
    const countdown = value === null ? undefined : value;
    if (this.settings.countdown === countdown) return;
    this.settings.countdown = countdown; this.changed();
  }
  microphoneName(options: RecordingOptions, devices: MicrophoneDevice[]): void {
    this.settings.microphoneName = devices.find(device => options.microphoneDeviceId
      ? device.id === options.microphoneDeviceId : device.isDefault)?.name ?? '系统默认麦克风';
  }
  start(timestamp: number): void {
    this.startedAt = timestamp; this.frames = [{ t: 0, ...this.layout }];
    this.effectFrames = [{ t: 0, effects: { ...this.settings.cameraEffects } }];
    this.modeFrames = [{ t: 0, mode: this.settings.cameraMode }];
  }
  snapshot(): LiveRecordingState { return { ...this.recordingState(), ...this.settings, cameraPresenter: structuredClone(this.settings.cameraPresenter), cameraEffects: { ...this.settings.cameraEffects } }; }
  keyframes(duration: number): CameraLayoutKeyframe[] { return this.frames.filter(frame => frame.t <= duration).map(frame => ({ ...frame })); }
  effectsKeyframes(duration: number): CameraEffectKeyframe[] {
    return this.effectFrames.filter(frame => frame.t <= duration).map(frame => ({ t: frame.t, effects: { ...frame.effects } }));
  }
  modeKeyframes(duration: number): CameraModeKeyframe[] {
    return this.modeFrames.filter(frame => frame.t <= duration).map(frame => ({ ...frame }));
  }
  cameraUnavailable(): void {
    this.settings.cameraAvailable = false; this.settings.cameraVisible = false;
    this.layout.visible = false; this.appendFrame();
  }
  attachCamera(sessionId: string): void {
    this.settings.cameraSessionId = sessionId;
    this.settings.cameraAvailable = true; this.settings.cameraVisible = this.layout.visible = true;
    this.appendFrame(); this.changed();
  }
  audioState(value: unknown): void {
    if (!value || typeof value !== 'object') throw new Error('声音设备状态返回无效');
    const state = value as Record<string, unknown>;
    for (const key of ['microphoneEnabled', 'microphoneMuted', 'systemAudioEnabled', 'systemAudioMuted'] as const) {
      if (typeof state[key] !== 'boolean') throw new Error('声音设备状态返回无效');
    }
    for (const key of ['microphoneEnabled', 'microphoneMuted', 'systemAudioEnabled', 'systemAudioMuted'] as const) this.settings[key] = state[key] as boolean;
    if (typeof state.microphoneDeviceId === 'string') this.settings.microphoneDeviceId = state.microphoneDeviceId;
    this.changed();
  }
  placement(value: { x: number; y: number }): void {
    if (!this.settings.cameraAvailable || this.settings.cameraMode === 'presenter' || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
    this.layout.x = Math.max(0, Math.min(1, value.x)); this.layout.y = Math.max(0, Math.min(1, value.y));
    this.preferences?.update({ camera: { x: this.layout.x, y: this.layout.y } });
    this.appendFrame();
  }
  private appendFrame(): void {
    if (this.startedAt === undefined || this.recordingState().status !== 'recording') return;
    const previous = this.frames.at(-1);
    const t = Math.max(previous?.t ?? 0, (Date.now() - this.startedAt) / 1000);
    // Preserve t=0 and fixed 50ms buckets, even during a continuous drag.
    if (this.frames.length > 1 && previous && Math.floor(t * 20) === Math.floor(previous.t * 20)) this.frames[this.frames.length - 1] = { t, ...this.layout };
    else this.frames.push({ t, ...this.layout });
  }
  private appendEffectFrame(): void {
    if (this.startedAt === undefined || this.recordingState().status !== 'recording') return;
    const previous = this.effectFrames.at(-1);
    const t = Math.max(previous?.t ?? 0, (Date.now() - this.startedAt) / 1000);
    const frame = { t, effects: { ...this.settings.cameraEffects } };
    // Fixed 50ms buckets prevent a continuous drag from sliding one frame forever.
    // Keep t=0 as an immutable initial snapshot, even for changes in the first bucket.
    if (this.effectFrames.length > 1 && previous && Math.floor(t * 20) === Math.floor(previous.t * 20)) this.effectFrames[this.effectFrames.length - 1] = frame;
    else this.effectFrames.push(frame);
  }
  private changeMode(mode: CameraMode, notify = true): void {
    if (mode !== 'overlay' && mode !== 'presenter') throw new Error('摄像头模式无效');
    const changed = this.settings.cameraMode !== mode;
    this.settings.cameraMode = mode;
    this.settings.cameraVisible = mode === 'presenter' || this.layout.visible;
    this.preferences?.update({ cameraMode: mode });
    if (changed && this.startedAt !== undefined && this.recordingState().status === 'recording') {
      const t = Math.max(this.modeFrames.at(-1)?.t ?? 0, (Date.now() - this.startedAt) / 1000);
      // Mode switches are discrete edits. Keep every transition, including rapid switches.
      this.modeFrames.push({ t, mode });
    }
    if (notify) this.changed();
  }
  async control(action: RecordingControlAction): Promise<void> {
    const preview = this.settings.cameraPreviewing && ['idle', 'error'].includes(this.recordingState().status);
    if (this.recordingState().status !== 'recording' && !preview) throw new Error('请等待录制准备完成');
    if (preview && !action.type.startsWith('camera-')) throw new Error('预览期间只能调整摄像头');
    if (action.type === 'microphone-source' || action.type === 'system-enabled') {
      const options = action.type === 'microphone-source' ? {
        microphoneEnabled: action.value.enabled, microphoneDeviceId: action.value.deviceId,
      } : { systemAudioEnabled: action.value };
      const attempt = this.audioChange.then(async () => {
        if (this.recordingState().status !== 'recording') throw new Error('录制已停止');
        const state = await this.native.request<Pick<LiveRecordingState, 'microphoneEnabled' | 'microphoneMuted' | 'microphoneDeviceId' | 'systemAudioEnabled' | 'systemAudioMuted'>>('recording-audio', { options });
        if (this.recordingState().status === 'recording') this.audioState(state);
      });
      this.audioChange = attempt.catch(() => {}); await attempt; return;
    }
    if (action.type === 'microphone-muted' || action.type === 'system-muted') {
      const microphone = action.type === 'microphone-muted';
      if (typeof action.value !== 'boolean') throw new Error('静音开关无效');
      if (microphone ? !this.settings.microphoneEnabled : !this.settings.systemAudioEnabled) throw new Error('这条音轨未开启');
      const attempt = this.audioChange.then(async () => {
        if (this.recordingState().status !== 'recording') throw new Error('录制已停止');
        const state = await this.native.request<{ microphoneMuted: boolean; systemAudioMuted: boolean }>('audio-mute', {
          options: { [microphone ? 'microphoneMuted' : 'systemAudioMuted']: action.value },
        });
        this.settings.microphoneMuted = state.microphoneMuted; this.settings.systemAudioMuted = state.systemAudioMuted;
        this.changed();
      });
      this.audioChange = attempt.catch(() => undefined); await attempt; return;
    }
    if (!this.settings.cameraAvailable) throw new Error('本次录制没有可用摄像头');
    switch (action.type) {
      case 'camera-presenter': {
        if (!preview || this.settings.countdown !== undefined) throw new Error('请在录制前调整口播画幅和取景');
        const value = parsePresenterSettings(action.value);
        this.settings.cameraPresenter = value;
        this.preferences?.update({ presenter: value }); this.changed(); return;
      }
      case 'camera-mode': this.changeMode(action.value); return;
      case 'camera-effects':
        this.settings.cameraEffects = parseCameraEffects({ ...this.settings.cameraEffects, ...parseCameraEffectsPatch(action.value) });
        this.appendEffectFrame(); this.changed(); return;
      case 'camera-visible':
      case 'camera-mirror': {
        if (typeof action.value !== 'boolean') throw new Error('摄像头开关无效');
        if (action.type === 'camera-visible') {
          if (!action.value && this.settings.cameraMode === 'presenter') this.changeMode('overlay', false);
          this.settings.cameraVisible = this.layout.visible = action.value;
        }
        else this.settings.cameraMirror = this.layout.mirror = action.value;
        break;
      }
      case 'camera-shape':
        if (!isCameraShape(action.value)) throw new Error('摄像头形状无效');
        this.settings.cameraShape = this.layout.shape = action.value; break;
      case 'camera-zoom':
        if (!Number.isFinite(action.value) || action.value < CAMERA_ZOOM_MIN || action.value > CAMERA_ZOOM_MAX) throw new Error('摄像头变焦超出范围');
        this.settings.cameraZoom = this.layout.zoom = action.value; break;
      case 'camera-size':
        if (!Number.isFinite(action.value) || action.value < 0.12 || action.value > 0.42) throw new Error('摄像头大小超出范围');
        this.settings.cameraSize = this.layout.size = action.value; break;
      default: throw new Error('录制操作无效');
    }
    // Hiding is a temporary recording action; an enabled camera must be visible next time.
    this.preferences?.update({ camera: { size: this.layout.size, shape: this.layout.shape, mirror: this.layout.mirror,
      ...(this.layout.zoom === undefined ? {} : { zoom: this.layout.zoom }) } });
    this.appendFrame(); this.changed();
  }
}
