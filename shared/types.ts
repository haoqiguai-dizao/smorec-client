import type { CameraShape } from './camera-shapes';
import type { MicrophoneEffects } from './microphone-effects';
import type { RecordingResolution } from './recording';

export interface Rect { x: number; y: number; width: number; height: number }
export interface CameraPanelLayout { camera: Rect; settings: Rect }
export interface CaptureSource {
  id: string;
  kind: 'screen' | 'window';
  name: string;
  width: number;
  height: number;
  thumbnail?: string;
  bounds?: Rect;
}
export interface RecordingOptions {
  sourceId: string;
  systemAudio: boolean;
  microphone: boolean;
  /** Capture click/typing activity and focused-control geometry. Mac requires input and accessibility access. */
  inputRecording?: boolean;
  microphoneDeviceId?: string;
  microphoneEffects?: MicrophoneEffects;
  fps: 30 | 60;
  resolution?: RecordingResolution;
  excludedApplications?: string[];
  crop?: Rect;
  cameraSessionId?: string;
  cameraEffects?: CameraEffects;
}
export interface CursorSample {
  /** Seconds on the original recording clock. Coordinates normalized to the captured frame. */
  t: number;
  x: number;
  y: number;
  visible: boolean;
  click?: boolean;
  shape?: 'arrow' | 'hand' | 'ibeam';
  /** Logical primary button state on position samples; absent in old recordings. */
  primaryDown?: boolean;
}
export interface InputActivity {
  /** Input activity on the source clock, without key values or entered text. */
  t: number;
  kind: 'typing' | 'reset';
  focus?: { x: number; y: number };
}
export interface Clip { id: string; start: number; end: number }
export interface ZoomSegment {
  id: string;
  start: number;
  end: number;
  x: number;
  y: number;
  scale: number;
  exitToFullView?: boolean;
}
export interface CompositionCamera {
  /** Digital crop applied only within this source-time interval. */
  zoom?: number;
  /** Top-left coordinates normalized to the output canvas, not source media. */
  x?: number;
  y?: number;
  /** Width as a fraction of the output canvas's shorter side. */
  size?: number;
  visible?: boolean;
  shape?: CameraShape;
  mirror?: boolean;
}
export interface CompositionSegment {
  /** Source-clock half-open interval [start, end). */
  id: string;
  start: number;
  end: number;
  camera?: CompositionCamera;
  screen: 'recording' | 'hidden' | 'background';
  /** Preset ID or project-owned asset:<id>, never an arbitrary filesystem path. */
  background?: string;
}
export interface CanvasStyle {
  background: string;
  padding: number;
  radius: number;
  shadow: number;
  aspect: 'auto' | '16:9' | '9:16' | '1:1';
  cursorScale: number;
  smoothing: number;
  showCursor: boolean;
  clickHighlight: boolean;
}
export interface BackgroundAsset { id: string; name: string; src: string }
export interface Project {
  demoCapture?: import('./demo').DemoRange[];
  whiteboard?: import('./whiteboard/types').BoardRecording;
  id: string;
  name: string;
  createdAt: string;
  duration: number;
  width: number;
  height: number;
  fps: 30 | 60;
  /** URLs issued by the main process. Never use caller-supplied paths in native commands. */
  media: { screen: string; systemAudio?: string; microphone?: string; camera?: string; whiteboard?: string };
  camera?: WebcamStyle;
  cursor: CursorSample[];
  inputActivity?: InputActivity[];
  clips: Clip[];
  zooms: ZoomSegment[];
  compositions?: CompositionSegment[];
  backgrounds?: BackgroundAsset[];
  style: CanvasStyle;
  audio: { system: number; microphone: number; microphoneEffects?: MicrophoneEffects };
}
export interface WebcamStyle {
  /** Full-canvas source alignment; independent of the PiP position. */
  presenterCrop?: import('./presenter').PresenterCrop;
  /** Centered digital zoom, independent of the camera window size. */
  zoom?: number;
  /** Camera media time corresponding to screen source time zero, in seconds. */
  offset: number;
  enabled: boolean;
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  size: number;
  mirror: boolean;
  shape: CameraShape;
  shrinkOnZoom: boolean;
  placement?: { x: number; y: number };
  keyframes?: CameraLayoutKeyframe[];
  useRecordedLayout?: boolean;
  /** False applies mirror independently of recorded position, size and visibility. */
  useRecordedMirror?: boolean;
  effects?: CameraEffects;
  effectKeyframes?: CameraEffectKeyframe[];
  useRecordedEffects?: boolean;
  /** Composition mode is independent of the small camera window's geometry. */
  mode?: CameraMode;
  modeKeyframes?: CameraModeKeyframe[];
  useRecordedMode?: boolean;
}
export type CameraMode = 'overlay' | 'presenter';
export interface CameraModeKeyframe { t: number; mode: CameraMode }
export interface CameraEffects {
  /** Optional for projects recorded before landmark beauty was introduced. */
  skinWhitening?: number;
  rosiness?: number;
  faceSlim?: number;
  faceSize?: number;
  jaw?: number;
  chin?: number;
  eyeEnlarge?: number;
  eyeDistance?: number;
  noseSlim?: number;
  mouthSize?: number;
  eyeBrightening?: number;
  teethWhitening?: number;
  enabled: boolean;
  smoothing: number;
  brightness: number;
  filter: 'natural' | 'warm' | 'cool' | 'mono';
  intensity: number;
}
export interface CameraEffectKeyframe { t: number; effects: CameraEffects }
export interface CameraLayoutKeyframe {
  zoom?: number;
  t: number; x: number; y: number; size: number; shape: CameraShape; mirror: boolean; visible: boolean;
}
export interface MicrophoneDevice {
  id: string; name: string; isDefault: boolean;
  transport?: 'bluetooth' | 'usb' | 'builtin' | 'other';
}
export interface LiveRecordingState extends RecordingState {
  cameraPresenter?: import('./presenter').PresenterSettings;
  cameraStreaming?: boolean;
  cameraZoom?: number;
  /** Acquisition identity survives the preview-to-recording transition. */
  cameraSessionId?: string;
  cameraPreviewing?: boolean;
  /** Pre-recording countdown in the camera preview; never persisted. */
  countdown?: number;
  cameraPanel?: CameraPanelLayout;
  /** Stable CSS camera size, independent of the native window's enclosing DIP readback. */
  cameraViewport?: { width: number; height: number };
  cameraAvailable: boolean; cameraVisible: boolean; cameraShape: CameraShape; cameraSize: number; cameraMirror: boolean;
  microphoneEnabled: boolean; microphoneMuted: boolean; microphoneName: string;
  microphoneDeviceId?: string;
  systemAudioEnabled: boolean; systemAudioMuted: boolean;
  cameraEffects?: CameraEffects;
  cameraMode?: CameraMode;
}
export type RecordingControlAction = { type: 'stop' }
  | { type: 'microphone-source'; value: { enabled: boolean; deviceId: string } }
  | { type: 'system-enabled'; value: boolean }
  | { type: 'camera-presenter'; value: import('./presenter').PresenterSettings }
  | { type: 'microphone-muted' | 'system-muted' | 'camera-visible' | 'camera-mirror'; value: boolean }
  | { type: 'camera-shape'; value: CameraShape }
  | { type: 'camera-size' | 'camera-zoom'; value: number }
  | { type: 'camera-mode'; value: CameraMode }
  | { type: 'camera-effects'; value: Partial<CameraEffects> };
export interface CameraPreviewMessage {
  sessionId: string;
  signal: { type: 'offer' | 'answer' | 'candidate' | 'viewport' | 'close'; sdp?: string; candidate?: RTCIceCandidateInit;
    viewport?: import('./camera-preview').CameraPreviewViewport };
}
/** Local display health, sampled periodically and on tier changes. Never contains media. */
export interface CameraPreviewQualityReport {
  tier: number;
  previousTier: number;
  framesPerSecond?: number;
  reason?: string;
  sourceFrameRate?: number;
  width?: number;
  height?: number;
  encoder?: string;
}
export interface RecordingOverlayApi {
  getState(): Promise<LiveRecordingState>;
  onState(callback: (state: LiveRecordingState) => void): () => void;
  control(action: RecordingControlAction): Promise<void>;
  setExpanded(expanded: boolean): Promise<void>;
  setCameraSettings(open: boolean): Promise<void>;
  previewReady(): Promise<{ sessionId: string }>;
  sendPreviewSignal(message: CameraPreviewMessage): Promise<void>;
  onPreviewSignal(callback: (message: CameraPreviewMessage) => void): () => void;
}
export interface CameraCommand { id: string; action: 'start' | 'stop' | 'cancel' }
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  duration: number;
}
export interface ProjectDeletionResult {
  deletedIds: string[];
  failed: { id: string; error: string }[];
}
export interface AppStatus {
  nativeAvailable: boolean;
  ffmpegAvailable: boolean;
  platform: string;
  version: string;
}
export interface RecordingState {
  warnings?: string[];
  status: 'idle' | 'starting' | 'recording' | 'stopping' | 'error';
  elapsed?: number;
  error?: string;
  startedAtUnixMs?: number;
}
export interface ExportSettings { codec?: 'vp8' | 'h264' | 'hevc'; width: number; height: number; fps: 30 | 60; frames: number }
export interface ExportSession { id: string; path: string }
export interface StudioApi {
  prepareAudio(projectId: string, audio: Project['audio']): Promise<string>;
  prepareMicrophone(projectId: string, effects: MicrophoneEffects): Promise<string>;
  cancelMicrophonePreparation(): Promise<void>;
  releaseAudio?(url: string): Promise<void>;
  openRecorder(): Promise<void>;
  getStatus(): Promise<AppStatus>;
  getSources(): Promise<CaptureSource[]>;
  getMicrophones(): Promise<MicrophoneDevice[]>;
  startRecording(options: RecordingOptions): Promise<void>;
  stopRecording(): Promise<Project>;
  onRecordingState(callback: (state: RecordingState) => void): () => void;
  onProjectReady(callback: (project: Project) => void): () => void;
  onBeforeClose(callback: () => Promise<void>): () => void;
  cameraPrepare(): Promise<{ id: string }>;
  cameraStarted(id: string, startedAtUnixMs: number, mimeType?: string): Promise<void>;
  cameraAppend(id: string, data: ArrayBuffer): Promise<void>;
  cameraFinish(id: string): Promise<void>;
  cameraCancel(id: string): Promise<void>;
  /** Frame liveness, which byte-level chunk health cannot observe while the recorder keeps flushing. */
  cameraFrameStall(id: string, stalledSeconds: number): Promise<void>;
  cameraFrameResumed(id: string): Promise<void>;
  onCameraCommand(callback: (command: CameraCommand) => void): () => void;
  onCameraPreviewRequest(callback: (sessionId: string) => void): () => void;
  cameraPreviewSignal(message: CameraPreviewMessage): Promise<void>;
  onCameraPreviewSignal(callback: (message: CameraPreviewMessage) => void): () => void;
  /** Preview transport load reports, so a choppy preview can be traced instead of guessed. */
  cameraPreviewQuality(id: string, detail: CameraPreviewQualityReport): Promise<void>;
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<Project>;
  saveProject(project: Project): Promise<void>;
  renameProject(id: string, name: string): Promise<ProjectSummary>;
  revealProject(id: string): Promise<void>;
  deleteProjects(ids: string[]): Promise<ProjectDeletionResult>;
  importVideo(): Promise<Project | null>;
  importBackground(projectId: string): Promise<BackgroundAsset | null>;
  openProject(): Promise<Project | null>;
  renderExport?(project: Project): Promise<string | null>;
  cancelRenderExport?(): Promise<void>;
  onRenderExportProgress?(callback: (value: import('./export-render').ExportRenderProgress) => void): () => void;
  exportStart(project: Project, settings: ExportSettings): Promise<ExportSession | null>;
  cancelExportPreparation(): Promise<void>;
  /** IVF packet: 12-byte header and encoded VP8 frame. */
  exportAppend(id: string, data: ArrayBuffer): Promise<void>;
  exportFinish(id: string): Promise<string>;
  exportCancel(id: string): Promise<void>;
  revealExport(path: string): Promise<void>;
  minimize(): void;
  maximize(): void;
  close(): void;
}
export type CameraRecordingApi = Pick<StudioApi, 'cameraPrepare' | 'cameraStarted' | 'cameraAppend' | 'cameraFinish'
  | 'cameraCancel' | 'cameraFrameStall' | 'cameraFrameResumed' | 'cameraPreviewQuality'
  | 'onCameraCommand' | 'onCameraPreviewRequest' | 'cameraPreviewSignal' | 'onCameraPreviewSignal'>;
export interface RecorderApi extends CameraRecordingApi, Pick<StudioApi, 'getStatus' | 'getSources' | 'getMicrophones'
  | 'startRecording' | 'onRecordingState'> {
  attachRecordingCamera?(id: string): Promise<void>;
  openCameraSettings(): Promise<void>;
  setExcludedApplications?(applications: string[]): Promise<void>;
  dragWindow(action: 'start' | 'move' | 'end'): Promise<void>;
  startMicrophoneTrial(deviceId: string): Promise<{ id: string }>;
  finishMicrophoneTrial(id: string): Promise<{ id: string; url: string; duration: number }>;
  cancelMicrophoneTrial(id: string): Promise<void>;
  processMicrophoneTrial(id: string, effects: MicrophoneEffects): Promise<string>;
  releaseAudio?(url: string): Promise<void>;
  cameraPreviewReady(id: string, effects: CameraEffects): Promise<void>;
  cameraPreviewClosed(id: string): Promise<void>;
  cameraPreviewCountdown(id: string, value: number | null): Promise<void>;
  onCameraEnabledChange(callback: (enabled: boolean) => void): () => void;
  onCameraEffectsChange(callback: (effects: CameraEffects) => void): () => void;
  openEditor(): Promise<void>;
  setExpanded(expanded: boolean): Promise<void>;
  onActivate(callback: () => void): () => void;
  quit(): void;
}
export interface NativeRecordingResult {
  warnings?: string[];
  /** Raw video duration may omit a final unchanged WGC frame interval. */
  videoDuration?: number;
  tailHold?: number;
  directory: string;
  duration: number;
  width: number;
  height: number;
  video: string;
  cursor: string;
  inputActivity?: string;
  systemAudio?: string;
  microphone?: string;
  startedAtUnixMs?: number;
}
declare global { interface Window { studio?: StudioApi; recorder?: RecorderApi; recordingOverlay?: RecordingOverlayApi; whiteboard?: import('./whiteboard/types').WhiteboardApi } }
