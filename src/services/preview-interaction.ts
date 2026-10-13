import { locateClip } from '../../shared/timeline';
import type { Project } from '../../shared/types';

type PreviewProject = Pick<Project, 'id' | 'media' | 'clips'>;
type PreviewMedia = Pick<HTMLVideoElement, 'readyState' | 'seeking' | 'paused'>;

export interface PreviewInteractionSnapshot {
  readonly projectId: string;
  readonly sourceTime: number;
  readonly outputTime: number;
  readonly clipIndex: number;
  readonly cameraAvailable: boolean;
}

export function displayedPreviewSnapshot(previous: PreviewProject | null | undefined, snapshot: PreviewInteractionSnapshot | undefined,
  current: PreviewProject | null): PreviewInteractionSnapshot | undefined {
  if (!previous || !current || !snapshot || previous.id !== current.id
    || previous.media.screen !== current.media.screen || previous.media.camera !== current.media.camera
    || previous.clips.length !== current.clips.length || previous.clips.some((clip, index) => {
      const next = current.clips[index];
      return clip.id !== next.id || clip.start !== next.start || clip.end !== next.end;
    })) return;
  return snapshot;
}

export interface PreviewFrameContext {
  project: PreviewProject | null;
  video: PreviewMedia | null;
  camera: PreviewMedia | null;
  outputTime: number;
  playing: boolean;
  mediaMatches: boolean;
  cameraMatches: boolean;
  hidden: boolean;
}

interface PresentedFrame {
  project: PreviewProject;
  video: PreviewMedia;
  camera: PreviewMedia | null;
  requestedOutputTime: number;
  clip: { id: string; start: number; end: number; offset: number };
  snapshot: PreviewInteractionSnapshot;
}

/** Only a completed compositor draw may publish a frame; seeking never republishes the previous one. */
export class PreviewInteractionFrames {
  private frame?: PresentedFrame;

  invalidate(): void { this.frame = undefined; }

  private stable(context: PreviewFrameContext): boolean {
    return Boolean(context.project && context.video && context.video.readyState >= 2 && !context.video.seeking
      && context.mediaMatches && !context.hidden && Number.isFinite(context.outputTime));
  }

  present(context: PreviewFrameContext, sourceTime: number, cameraWasRendered: boolean): void {
    if (!this.stable(context) || !Number.isFinite(sourceTime)) { this.invalidate(); return; }
    const project = context.project!, video = context.video!;
    const located = locateClip(project.clips, context.outputTime);
    if (!located || sourceTime < located.clip.start || sourceTime > located.clip.end) { this.invalidate(); return; }
    const cameraAvailable = Boolean(cameraWasRendered && context.cameraMatches && context.camera
      && context.camera.readyState >= 2 && !context.camera.seeking);
    this.frame = { project, video, camera: context.camera, requestedOutputTime: context.outputTime,
      clip: { id: located.clip.id, start: located.clip.start, end: located.clip.end, offset: located.offset },
      snapshot: Object.freeze({ projectId: project.id, sourceTime,
        outputTime: located.offset + sourceTime - located.clip.start, clipIndex: located.index, cameraAvailable }) };
  }

  presented(context: PreviewFrameContext): PreviewInteractionSnapshot | undefined {
    const frame = this.frame;
    const located = context.project ? locateClip(context.project.clips, context.outputTime) : null;
    if (!frame || !this.stable(context) || context.project !== frame.project || context.video !== frame.video
      || Math.abs(context.outputTime - frame.requestedOutputTime) > 1e-6
      || located?.index !== frame.snapshot.clipIndex || located.clip.id !== frame.clip.id
      || located.clip.start !== frame.clip.start || located.clip.end !== frame.clip.end || located.offset !== frame.clip.offset) return;
    return frame.snapshot;
  }

  interaction(context: PreviewFrameContext): PreviewInteractionSnapshot | undefined {
    const snapshot = this.presented(context);
    if (!snapshot?.cameraAvailable || context.playing || !context.video?.paused || !context.camera?.paused
      || context.camera !== this.frame?.camera || !context.cameraMatches
      || context.camera.readyState < 2 || context.camera.seeking) return;
    return snapshot;
  }
}
