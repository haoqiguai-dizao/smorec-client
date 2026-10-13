import { CAMERA_PREVIEW_TIERS, MAX_CAMERA_PREVIEW_TIER, type CameraPreviewTier } from '../../shared/camera-preview';

/** One outbound-rtp report worth listening to; missing fields must never count as healthy. */
export interface CameraPreviewQualitySample {
  framesPerSecond?: number;
  qualityLimitationReason?: string;
  framesEncoded?: number;
  timestamp?: number;
  sourceFrameRate?: number;
  encoderId?: string;
  width?: number;
  height?: number;
  encoder?: string;
}

export interface CameraPreviewQualityVerdict {
  tier: CameraPreviewTier;
  previous: CameraPreviewTier;
  changed: boolean;
  strained: boolean;
  reason?: 'cpu' | 'framerate';
}

export const PREVIEW_STRAIN_LIMIT = 2;
export const PREVIEW_RECOVERY_LIMIT = 8;
/** Below this share of the target the picture reads as choppy rather than merely detailed. */
export const PREVIEW_FRAME_REACH = .7;

function strain(sample: CameraPreviewQualitySample, targetFrameRate: number): CameraPreviewQualityVerdict['reason'] {
  if (sample.qualityLimitationReason === 'cpu') return 'cpu';
  const fps = sample.framesPerSecond;
  // A slow source is not evidence that the preview encoder needs less work.
  if (sample.sourceFrameRate !== undefined && sample.sourceFrameRate >= 0)
    targetFrameRate = Math.min(targetFrameRate, sample.sourceFrameRate);
  if (typeof fps === 'number' && Number.isFinite(fps) && fps >= 0 && fps < targetFrameRate * PREVIEW_FRAME_REACH) return 'framerate';
  return undefined;
}

/**
 * Reduce work only on valid active-video samples. Recovery is measured against the current
 * cap, so a healthy 15 FPS tier can recover even when the original source requests 30 FPS.
 */
export class CameraPreviewQuality {
  private level: CameraPreviewTier = 0;
  private strainRun = 0;
  private recoveryRun = 0;

  constructor(private readonly targetFrameRate = 30) {}

  get tier(): CameraPreviewTier { return this.level; }
  pause(): void { this.strainRun = 0; this.recoveryRun = 0; }

  observe(sample: CameraPreviewQualitySample): CameraPreviewQualityVerdict {
    const previous = this.level;
    const validFps = typeof sample.framesPerSecond === 'number' && Number.isFinite(sample.framesPerSecond) && sample.framesPerSecond >= 0;
    if (!validFps && sample.qualityLimitationReason !== 'cpu') {
      this.pause(); return { tier: this.level, previous, changed: false, strained: false };
    }
    const target = Math.max(1, Math.round(this.targetFrameRate * CAMERA_PREVIEW_TIERS[this.level].frameRate));
    const reason = strain(sample, target);
    // A stopped source / congested connection must not accumulate healthy recovery samples.
    if (!reason && (!validFps || sample.framesPerSecond! === 0 || sample.qualityLimitationReason === 'bandwidth')) {
      this.pause(); return { tier: this.level, previous, changed: false, strained: false };
    }
    if (reason) { this.strainRun++; this.recoveryRun = 0; }
    else { this.recoveryRun++; this.strainRun = 0; }
    if (this.strainRun >= PREVIEW_STRAIN_LIMIT && this.level < MAX_CAMERA_PREVIEW_TIER) {
      this.level = (this.level + 1) as CameraPreviewTier;
      this.strainRun = 0;
    } else if (this.recoveryRun >= PREVIEW_RECOVERY_LIMIT && this.level > 0) {
      this.level = (this.level - 1) as CameraPreviewTier;
      this.recoveryRun = 0;
    }
    return { tier: this.level, previous, changed: this.level !== previous, strained: reason !== undefined, reason };
  }
}

/** The eager first reports describe negotiation, not sustained load, so they are ignored. */
export const PREVIEW_QUALITY_WARMUP = 1;

export interface PreviewQualityProbe {
  getStats(): Promise<RTCStatsReport>;
}

/** Read the outbound video report without assuming every browser exposes every field. */
export function cameraPreviewSample(report: RTCStatsReport, previous?: CameraPreviewQualitySample): CameraPreviewQualitySample {
  let found: CameraPreviewQualitySample = {};
  report.forEach(entry => {
    const stats = entry as RTCStats & Record<string, unknown>;
    if (stats.type !== 'outbound-rtp' || stats.kind !== 'video') return;
    const source = typeof stats.mediaSourceId === 'string' ? report.get(stats.mediaSourceId) : undefined;
    found = {
      framesPerSecond: typeof stats.framesPerSecond === 'number' ? stats.framesPerSecond : undefined,
      qualityLimitationReason: typeof stats.qualityLimitationReason === 'string' ? stats.qualityLimitationReason : undefined,
      framesEncoded: typeof stats.framesEncoded === 'number' ? stats.framesEncoded : undefined,
      timestamp: typeof stats.timestamp === 'number' ? stats.timestamp : undefined,
      sourceFrameRate: typeof source?.framesPerSecond === 'number' ? source.framesPerSecond : undefined,
      encoderId: stats.id,
      width: typeof stats.frameWidth === 'number' ? stats.frameWidth : undefined,
      height: typeof stats.frameHeight === 'number' ? stats.frameHeight : undefined,
      encoder: typeof stats.encoderImplementation === 'string' ? stats.encoderImplementation : undefined,
    };
  });
  if (previous && found.encoderId === previous.encoderId && found.framesPerSecond === undefined
    && found.framesEncoded !== undefined && previous.framesEncoded !== undefined
    && found.timestamp !== undefined && previous.timestamp !== undefined) {
    const elapsed = found.timestamp - previous.timestamp, frames = found.framesEncoded - previous.framesEncoded;
    if (elapsed > 0 && frames >= 0) found.framesPerSecond = frames * 1000 / elapsed;
  }
  return found;
}

export const previewTierLabel = (tier: CameraPreviewTier): string =>
  `${Math.round(CAMERA_PREVIEW_TIERS[tier].scale * 100)}% preview detail · ${Math.round(CAMERA_PREVIEW_TIERS[tier].frameRate * 100)}% cadence`;
