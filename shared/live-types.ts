import type { CanvasStyle, CursorSample, InputActivity, LiveRecordingState, Rect } from './types';
import type { LiveOutputMode, StreamConnection, StreamProfilesApi } from './streaming';
import type { LiveRuntimeIssue } from './live-issues';
import type { BoardEvent } from './whiteboard/types';
export const VIRTUAL_CAMERA_NAME = '小录 Virtual Camera';

export interface VirtualCameraStatus { available: boolean; installed: boolean; name: string; installable?: boolean; error?: string }
export interface LiveApplication { id: string; name: string; executable: string }
export interface LiveOptions {
  sourceId: string; crop?: Rect; portrait?: boolean; excludedApplications?: string[];
  output?: LiveOutputMode; streamProfileId?: string;
  preview?: boolean;
  inputRecording?: boolean;
  systemAudio?: boolean; microphone?: boolean; microphoneDeviceId?: string;
}
export interface LiveState {
  status: 'idle' | 'starting' | 'live' | 'stopping' | 'error'; id?: string; error?: string; frames?: number; cameraSettingsOpen?: boolean;
  output?: LiveOutputMode; connection?: StreamConnection;
  phase?: 'preview' | 'broadcast';
  audio?: LiveAudioState;
  startedAtUnixMs?: number;
}
export type LiveAudioChannel = 'microphone' | 'system';
export interface LiveAudioState { microphone: boolean; system: boolean }
export interface LiveConfiguration { id: string; width: number; height: number; fps: number; style: CanvasStyle; inputRecording?: boolean }
export interface LiveInput { cursor?: CursorSample; activity?: InputActivity }
export interface LiveFrame {
  whiteboard?: LiveBoardFrame;
  demoVisible?: boolean;
  audioLevel?: number;
  width: number; height: number; time: number; pixels: Uint8Array;
  input: LiveInput[]; camera: LiveRecordingState; placement: { x: number; y: number }; shrinkOnZoom: boolean;
  demoCameraIndependent?: boolean;
}
export interface LiveBoardFrame { session: string; from: number; events: BoardEvent[] }
export type LiveAction = 'reset-zoom' | 'toggle-auto-zoom' | 'toggle-presenter';
export interface LiveApi {
  profiles?: StreamProfilesApi;
  applications(): Promise<LiveApplication[]>;
  status(): Promise<VirtualCameraStatus>;
  install(): Promise<VirtualCameraStatus>;
  setExcludedApplications(id: string, applications: string[]): Promise<void>;
  start(options: LiveOptions): Promise<LiveConfiguration>;
  broadcast?(id: string): Promise<void>;
  setAudio?(id: string, channel: LiveAudioChannel, enabled: boolean): Promise<LiveAudioState>;
  pull(id: string): Promise<LiveFrame>;
  push(id: string, pixels: ArrayBuffer): Promise<void>;
  stop(): Promise<void>;
  report?(id: string, issue: LiveRuntimeIssue): Promise<void>;
  hideControls(): Promise<void>;
  onState(callback: (state: LiveState) => void): () => void;
  onAction(callback: (action: LiveAction) => void): () => void;
  onPreviewVisibility?(callback: (visible: boolean) => void): () => void;
}
declare global { interface Window { live?: LiveApi } }
