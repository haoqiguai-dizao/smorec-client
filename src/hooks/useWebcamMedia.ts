import { useCallback, useEffect, useRef } from 'react';
import type { Project } from '../../shared/types';
import { observeVideoFrames } from '../services/media-frame-identity';

export function useWebcamMedia(project: Project | null, redraw: () => void, reportError: (message: string) => void, sourceTime: () => number) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const projectRef = useRef(project); projectRef.current = project;
  const errorRef = useRef(reportError); errorRef.current = reportError;
  useEffect(() => {
    if (!project?.media.camera) return;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous'; video.muted = true; video.playsInline = true; video.preload = 'auto';
    ref.current = video;
    const stopFrames = observeVideoFrames(video);
    const loaded = () => { video.currentTime = Math.max(0, Math.min(sourceTime() + (projectRef.current?.camera?.offset ?? 0), video.duration - 0.001)); redraw(); };
    const failed = () => errorRef.current('摄像头视频无法读取，请重新打开工程');
    video.addEventListener('loadeddata', loaded); video.addEventListener('seeked', redraw); video.addEventListener('error', failed);
    video.src = project.media.camera;
    return () => {
      stopFrames();
      video.pause(); video.removeEventListener('loadeddata', loaded); video.removeEventListener('seeked', redraw); video.removeEventListener('error', failed);
      video.removeAttribute('src'); video.load(); ref.current = null;
    };
  }, [project?.id, project?.media.camera, redraw, sourceTime]);
  const sync = useCallback((sourceTime: number, force = false) => {
    const video = ref.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const time = Math.max(0, Math.min(sourceTime + (projectRef.current?.camera?.offset ?? 0), video.duration - 0.001));
    // Replacing an in-flight seek every animation frame can starve a slow decoder indefinitely.
    if (force || !video.seeking && Math.abs(video.currentTime - time) > 0.12) video.currentTime = time;
  }, []);
  return { ref, sync };
}
