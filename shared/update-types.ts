export type ReleaseChannel = 'stable' | 'beta';
export interface ReleaseArtifact {
  platform: 'win32'; arch: 'x64'; name: string; url: string; size: number; sha256: string; sha512: string;
}
export interface MacReleaseArtifact {
  platform: 'darwin'; arch: 'arm64'; name: string; url: string; size: number; sha256: string; sha512: string;
}
export interface ReleasePayload {
  product: 'smorec'; version: string; channel: ReleaseChannel; publishedAt: string;
  releaseNotes: string; artifacts: ReleaseArtifact[];
  /** Signed separately from the installer list so legacy clients keep their existing feed. */
  appUpdate?: ReleaseArtifact;
  /** Kept outside legacy artifacts so old Windows clients retain their exact feed shape. */
  macArtifacts?: MacReleaseArtifact[];
}
export interface SignedRelease { schema: 1; keyId: string; payload: ReleasePayload; signature: string }
export interface UpdateSnapshot {
  status: 'unconfigured' | 'idle' | 'checking' | 'downloading' | 'preparing' | 'ready' | 'installing' | 'deferred' | 'error';
  currentVersion: string; version?: string; progress?: number; releaseNotes?: string; error?: string; manualDownload?: boolean;
}
export interface UpdateConfiguration {
  serviceUrl: string; channel: ReleaseChannel; publicKeys: Record<string, string>;
}
