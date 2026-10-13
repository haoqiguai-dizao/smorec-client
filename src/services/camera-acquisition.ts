import type { CameraRecordingApi } from '../../shared/types';
import { SwitchableWebcamRecorder } from './switchable-webcam-recorder';
import { configureCameraFormat, validateCameraDimensions } from './camera-quality';
import { openCameraInput } from './camera-input';
import { DEFAULT_CAMERA_FORMAT, type CameraFormatPreference } from './camera-format';
import { CameraConnectionCanceledError } from './camera-errors';
export { cameraConnectionCanceled } from './camera-errors';

export interface AcquiredCamera {
  readonly id: string;
  readonly stream: MediaStream;
  readonly sourceStream?: MediaStream;
  replace?(stream: MediaStream): Promise<void>;
  ready(): Promise<void>;
  start(): Promise<void>;
  finish(): Promise<void>;
  cancel(notify?: boolean): Promise<void>;
}
export type CameraConnectionPhase = 'preparing' | 'device' | 'frames';
interface AcquisitionOptions {
  api: () => CameraRecordingApi | undefined;
  media: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  recorder?: (id: string, stream: MediaStream, api: CameraRecordingApi, failed: (error: Error) => void) => AcquiredCamera;
  timeout?: Partial<{ prepare: number; device: number; frames: number; cleanup: number }>;
}
interface Attempt {
  abort: AbortController;
  api: CameraRecordingApi;
  id?: string;
  stream?: MediaStream;
  recorder?: AcquiredCamera;
  leaseCleanup?: Promise<void>;
  cleanup?: Promise<void>;
}
const canceled = () => new CameraConnectionCanceledError();

function bounded<T>(promise: Promise<T>, timeout: number, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (action: () => void) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); action(); };
    const abort = () => finish(() => reject(canceled()));
    const timer = setTimeout(() => finish(() => reject(new Error(message))), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    if (signal?.aborted) abort();
  });
}

/** Logical cancellation is necessary because getUserMedia itself has no abort API. */
export class CameraAcquisition {
  private attempt?: Attempt;
  private cleaning = Promise.resolve();
  private readonly timeout;
  constructor(private options: AcquisitionOptions) {
    this.timeout = { prepare: 5000, device: 20000, frames: 6000, cleanup: 2500, ...options.timeout };
  }

  current(): AcquiredCamera | undefined { return this.attempt?.recorder; }
  pending(): boolean { return Boolean(this.attempt); }
  owns(id: string): boolean { return this.attempt?.id === id; }

  async connect(deviceId: string, failed: (error: Error) => void, phase: (value: CameraConnectionPhase) => void = () => {},
    format: CameraFormatPreference = DEFAULT_CAMERA_FORMAT): Promise<AcquiredCamera> {
    const api = this.options.api();
    if (!api) throw new Error('请在小录桌面版中使用摄像头');
    const previous = this.attempt;
    const attempt: Attempt = { api, abort: new AbortController() };
    this.attempt = attempt;
    this.retire(previous);
    const { signal } = attempt.abort;
    try {
      await bounded(this.cleaning, this.timeout.cleanup + 100, '摄像头清理超时，请重试', signal);
      if (signal.aborted) throw canceled();
      phase('preparing');
      const prepare = Promise.resolve().then(() => {
        if (signal.aborted) throw canceled();
        return api.cameraPrepare();
      }).then(value => {
        attempt.id = value.id;
        if (signal.aborted) void this.cancelLease(attempt);
        return value;
      });
      const { id } = await bounded(prepare, this.timeout.prepare, '摄像头准备超时，请重试', signal);
      if (signal.aborted) throw canceled();
      phase('device');
      const opening = openCameraInput(this.options.media, deviceId, format, signal).then(stream => {
        attempt.stream = stream;
        if (signal.aborted) stream.getTracks().forEach(track => track.stop());
        return stream;
      });
      const stream = await bounded(opening, this.timeout.device, '连接摄像头超时，请检查设备后重试，或选择其他摄像头', signal);
      if (signal.aborted) throw canceled();
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') throw new Error('摄像头未能提供可用画面，请重新连接设备');
      const openedDeviceId = track.getSettings().deviceId || deviceId;
      if (deviceId && openedDeviceId !== deviceId) throw new Error('摄像头设备发生变化，请重新选择');
      await bounded(configureCameraFormat(track, format, signal), this.timeout.device, '摄像头格式协商超时，请选择设备支持的格式', signal);
      if (signal.aborted) throw canceled();
      validateCameraDimensions(track.getSettings());
      const recordingApi = { ...api, cameraCancel: () => this.cancelLease(attempt) };
      const create = this.options.recorder ?? ((...args) => new SwitchableWebcamRecorder(...args));
      const recorder = create(id, stream, recordingApi, error => {
        if (this.attempt === attempt && !signal.aborted) failed(error);
      });
      attempt.recorder = recorder;
      phase('frames');
      await bounded(recorder.ready(), this.timeout.frames, '摄像头已连接，但没有持续送来画面，请重试或选择其他设备', signal);
      if (signal.aborted) throw canceled();
      return recorder;
    } catch (error) {
      const interrupted = signal.aborted;
      if (this.attempt === attempt) this.attempt = undefined;
      this.retire(attempt);
      throw interrupted ? canceled() : error;
    }
  }

  async replace(deviceId: string, format: CameraFormatPreference): Promise<AcquiredCamera> {
    const attempt = this.attempt, current = attempt?.recorder;
    if (!attempt || !current?.replace) throw new Error('当前摄像头不能切换，请重新连接');
    let accepting = true, source: MediaStream | undefined;
    try {
      const opened = await bounded(openCameraInput(this.options.media, deviceId, format, attempt.abort.signal).then(stream => {
        if (!accepting || attempt.abort.signal.aborted || this.attempt !== attempt) stream.getTracks().forEach(track => track.stop());
        return stream;
      }), this.timeout.device, '连接摄像头超时，原摄像头保持', attempt.abort.signal);
      source = opened;
      const track = opened.getVideoTracks()[0];
      if (!track || track.readyState !== 'live' || deviceId && track.getSettings().deviceId !== deviceId) throw new Error('所选摄像头未能连接，原摄像头保持');
      await bounded(configureCameraFormat(track, format, attempt.abort.signal), this.timeout.device, '摄像头格式协商超时，原摄像头保持', attempt.abort.signal);
      validateCameraDimensions(track.getSettings());
      if (this.attempt !== attempt || attempt.abort.signal.aborted) throw canceled();
      await current.replace(opened);
      attempt.stream = opened;
      return current;
    } catch (error) { source?.getTracks().forEach(track => track.stop()); throw error; }
    finally { accepting = false; }
  }

  /** Supplying a session id keeps an older recording failure from closing its replacement. */
  release(expectedId?: string): Promise<void> {
    const attempt = this.attempt;
    if (expectedId && attempt?.id !== expectedId) return Promise.resolve();
    this.attempt = undefined;
    this.retire(attempt);
    return this.cleaning;
  }

  completed(recorder: AcquiredCamera): boolean {
    if (this.attempt?.recorder !== recorder) return false;
    this.attempt.abort.abort(); this.attempt = undefined;
    return true;
  }

  private cancelLease(attempt: Attempt): Promise<void> {
    if (!attempt.id) return Promise.resolve();
    if (!attempt.leaseCleanup) attempt.leaseCleanup = bounded(Promise.resolve().then(() => attempt.api.cameraCancel(attempt.id!)),
      this.timeout.cleanup, '摄像头会话清理超时').catch(() => undefined);
    return attempt.leaseCleanup;
  }

  private retire(attempt?: Attempt) {
    if (!attempt) return;
    attempt.abort.abort();
    if (!attempt.cleanup) {
      const stop = attempt.recorder?.cancel(false) ?? Promise.resolve();
      if (!attempt.recorder) attempt.stream?.getTracks().forEach(track => track.stop());
      attempt.cleanup = Promise.all([this.cancelLease(attempt), bounded(stop, this.timeout.cleanup, '摄像头释放超时').catch(() => undefined)])
        .then(() => undefined);
    }
    this.cleaning = Promise.all([this.cleaning, attempt.cleanup]).then(() => undefined);
  }
}
