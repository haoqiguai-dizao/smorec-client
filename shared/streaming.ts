export type LiveOutputMode = 'camera' | 'stream';
export interface StreamEncoding {
  resolution: '720p' | '1080p';
  fps: 30 | 60;
  bitrate: number;
  keyframeSeconds: number;
}
export interface StreamProfile extends StreamEncoding { id: string; name: string; server: string; key: string }
export type StreamProfileDraft = Omit<StreamProfile, 'id'> & { id?: string };
export interface StreamProfileSummary extends StreamEncoding { id: string; name: string; needsCredentials?: boolean }
export interface StreamConnection {
  status: 'connecting' | 'streaming' | 'reconnecting' | 'failed';
  attempt: number;
  bitrate: number;
  frames: number;
  dropped: number;
  error?: string;
}
export interface StreamProfilesApi {
  list(): Promise<StreamProfileSummary[]>;
  read(id: string): Promise<StreamProfile>;
  save(profile: StreamProfileDraft): Promise<StreamProfileSummary>;
  remove(id: string): Promise<void>;
}
export const DEFAULT_STREAM_ENCODING: StreamEncoding = { resolution: '720p', fps: 30, bitrate: 4500, keyframeSeconds: 2 };
