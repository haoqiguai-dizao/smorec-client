import { useCallback, useEffect, useRef } from 'react';
import type { Project } from '../../shared/types';
import { boardVideoVisible } from '../../shared/whiteboard/video';
import { observeVideoFrames } from '../services/media-frame-identity';

/** Independent media clock, paused outside complete-interface segments. */
export function useWhiteboardMedia(project: Project | null, redraw: () => void,
  reportError: (message: string) => void, sourceTime: () => number) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const current = useRef(project); current.current = project;
  const error = useRef(reportError); error.current = reportError;
  const playing = useRef(false);
  const pause = useCallback(() => { playing.current = false; ref.current?.pause(); }, []);
  const sync = useCallback((source: number, play: boolean, force = false) => {
    playing.current = play;
    const video = ref.current, active = current.current;
    if (!video || !active || !Number.isFinite(video.duration)) return;
    const time = Math.max(0, Math.min(source + (active.whiteboard?.video?.offset ?? 0), video.duration - .001));
    if (force || !video.seeking && Math.abs(video.currentTime - time) > .12) video.currentTime = time;
    const visible = boardVideoVisible(active, source);
    if (play && visible && video.paused && time < video.duration - .002) {
      void video.play().catch(cause => {
        if (playing.current && cause?.name !== 'AbortError') error.current('白板界面播放失败，请重新打开工程');
      });
    } else if (!play || !visible) video.pause();
  }, []);
  useEffect(() => {
    if (!project?.media.whiteboard) return;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous'; video.muted = true; video.playsInline = true; video.preload = 'auto';
    ref.current = video;
    const stopFrames = observeVideoFrames(video);
    const loaded = () => { sync(sourceTime(), playing.current, true); redraw(); };
    const failed = () => error.current('白板界面视频无法读取，请重新打开工程');
    video.addEventListener('loadeddata', loaded); video.addEventListener('seeked', redraw); video.addEventListener('error', failed);
    video.src = project.media.whiteboard;
    return () => {
      stopFrames();
      video.pause(); video.removeEventListener('loadeddata', loaded); video.removeEventListener('seeked', redraw);
      video.removeEventListener('error', failed); video.removeAttribute('src'); video.load(); ref.current = null;
    };
  }, [project?.id, project?.media.whiteboard, redraw, sourceTime, sync]);
  return { ref, sync, pause };
}
