import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../../shared/types';
import { getOutputDuration, locateClip, outputToSourceTime } from '../../shared/timeline';
import { renderFrame } from '../services/compositor';
import { useWebcamMedia } from './useWebcamMedia';
import { useWhiteboardMedia } from './useWhiteboardMedia';
import { PlaybackClock } from '../services/playback-clock';
import { disposeWebcamEffects } from '../services/webcam-compositor';
import { FACE_READY_EVENT } from '../services/camera-effects/face/tracker';
import { usePreviewAudioTracks } from './usePreviewAudioTracks';
import { useProjectAudio } from './useProjectAudio';
import { usePreviewResolution } from './usePreviewResolution';
import { useCompositionBackground } from './useCompositionBackground';
import { displayedPreviewSnapshot, PreviewInteractionFrames, type PreviewInteractionSnapshot } from '../services/preview-interaction';
import { PreviewCadence } from '../services/preview-cadence';
import { disposeCompositionDecoration } from '../services/compositor-decoration';
import { prepareBoardImages } from '../services/whiteboard-images';
import { frameContentAt } from '../../shared/frame-content';

export function usePreview(project: Project | null, onError: (message: string) => void) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const webcamRef = useRef<HTMLVideoElement | null>(null);
  const webcamSourceRef = useRef<{ current: HTMLVideoElement | null } | null>(null);
  const boardSourceRef = useRef<{ current: HTMLVideoElement | null } | null>(null);
  const boardPauseRef = useRef<() => void>(() => {});
  const audioRef = useRef<Record<string, HTMLAudioElement>>({});
  const projectRef = useRef(project);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const loadedMedia = useRef<{ projectId: string; screen: string } | null>(null);
  const presentedFrames = useRef(new PreviewInteractionFrames());
  const clockRef = useRef(new PlaybackClock());
  const playRequest = useRef(0);
  const cadence = useRef(new PreviewCadence());
  const redrawOnPause = useRef<() => void>(() => {});
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [presented, setPresented] = useState<{ project: Project; snapshot: PreviewInteractionSnapshot }>();
  const [ready, setReady] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const errorRef = useRef(onError);
  const effectsFailure = useRef(false);
  projectRef.current = project; errorRef.current = onError;

  const frameContext = useCallback(() => {
    const active = projectRef.current, camera = webcamSourceRef.current?.current ?? null;
    return { project: active, video: videoRef.current, camera, outputTime: timeRef.current,
      playing: playingRef.current, hidden: document.hidden,
      mediaMatches: Boolean(active && loadedMedia.current?.projectId === active.id && loadedMedia.current.screen === active.media.screen),
      cameraMatches: Boolean(active?.media.camera && camera?.src === active.media.camera) };
  }, []);
  const publishPresented = useCallback(() => {
    const context = frameContext(), snapshot = presentedFrames.current.presented(context);
    setPresented(previous => {
      if (!snapshot || !context.project) return undefined;
      if (previous?.project === context.project && previous.snapshot.sourceTime === snapshot.sourceTime
        && previous.snapshot.outputTime === snapshot.outputTime && previous.snapshot.clipIndex === snapshot.clipIndex
        && previous.snapshot.cameraAvailable === snapshot.cameraAvailable) return previous;
      return { project: context.project, snapshot };
    });
  }, [frameContext]);
  const invalidatePresented = useCallback(() => { presentedFrames.current.invalidate(); setPresented(undefined); }, []);
  const interactionSnapshot = useCallback(() => presentedFrames.current.interaction(frameContext()), [frameContext]);

  const sourceTime = useCallback(() => {
    const video = videoRef.current, active = projectRef.current;
    if (!video || !active) return 0;
    const located = locateClip(active.clips, timeRef.current);
    const source = clockRef.current.read(video);
    return located ? Math.max(located.clip.start, Math.min(source, located.clip.end)) : source;
  }, []);

  const pause = useCallback(() => {
    playRequest.current++;
    if (videoRef.current) clockRef.current.pause(videoRef.current);
    playingRef.current = false; setPlaying(false);
    videoRef.current?.pause();
    webcamSourceRef.current?.current?.pause();
    boardPauseRef.current();
    Object.values(audioRef.current).forEach((audio) => audio?.pause());
    // Cadence may have skipped the latest clock tick; publish the actual paused frame for editing.
    redrawOnPause.current();
    publishPresented();
  }, [publishPresented]);

  const draw = useCallback(() => {
    const active = projectRef.current, canvas = canvasRef.current, video = videoRef.current;
    if (!active || !canvas || !video || video.readyState < 2 || video.seeking || document.hidden) { invalidatePresented(); return; }
    const size = resolutionRef.current;
    if (!size) { invalidatePresented(); return; }
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (context) {
      const camera = webcamSourceRef.current?.current, source = sourceTime();
      const cameraInput = camera && camera.readyState >= 2 && source + (active.camera?.offset ?? 0) >= 0
        && source + (active.camera?.offset ?? 0) < camera.duration + .05 ? camera : undefined;
      try {
        const board = boardSourceRef.current?.current;
        renderFrame(context, video, active, source, size.width, size.height,
          cameraInput, 'preview', backgroundRef.current?.(active, source), undefined,
          board && board.readyState >= 2 && !board.seeking ? board : undefined);
        effectsFailure.current = false;
      } catch (cause) {
        if (!effectsFailure.current) errorRef.current(cause instanceof Error ? cause.message : '摄像头效果无法处理');
        effectsFailure.current = true; invalidatePresented(); return;
      }
      presentedFrames.current.present(frameContext(), source, Boolean(cameraInput) && frameContentAt(active, source).camera);
      if (!playingRef.current) publishPresented();
      canvas.dataset.sourceTime = String(source);
      canvas.dataset.cameraTime = cameraInput ? String(cameraInput.currentTime) : '';
    } else invalidatePresented();
  }, [sourceTime, frameContext, invalidatePresented, publishPresented]);
  redrawOnPause.current = draw;
  useEffect(() => {
    if (!project) return;
    let active = true;
    void prepareBoardImages(project.id, project.whiteboard).then(() => { if (active) draw(); })
      .catch(error => { if (active) errorRef.current(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [project?.id, project?.whiteboard, draw]);
  const background = useCompositionBackground(project?.id, draw, onError);
  useEffect(() => {
    // Playback already has a frame loop. Async face results only force a redraw of a paused frame.
    const faceReady = () => { if (!playingRef.current) draw(); };
    window.addEventListener(FACE_READY_EVENT, faceReady); return () => window.removeEventListener(FACE_READY_EVENT, faceReady);
  }, [draw]);
  const backgroundRef = useRef(background);
  backgroundRef.current = background;
  const resolutionRef = usePreviewResolution(canvasRef, project, draw, pause);
  const webcam = useWebcamMedia(project, draw, onError, sourceTime);
  const whiteboard = useWhiteboardMedia(project, draw, onError, sourceTime);
  boardSourceRef.current = whiteboard.ref;
  boardPauseRef.current = whiteboard.pause;
  webcamSourceRef.current = webcam.ref;
  webcamRef.current = webcam.ref.current;
  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    return () => { if (context) { disposeWebcamEffects(context); disposeCompositionDecoration(context); } };
  }, [project?.id]);

  const audioSource = useProjectAudio(project, onError);

  const playMedia = useCallback(async () => {
    const request = ++playRequest.current;
    const source = sourceTime(), camera = webcamRef.current;
    whiteboard.sync(source, true);
    const pending: Promise<void>[] = [];
    if (videoRef.current && !clockRef.current.holding) pending.push(videoRef.current.play());
    if (camera && source + (projectRef.current?.camera?.offset ?? 0) < camera.duration) pending.push(camera.play());
    for (const audio of Object.values(audioRef.current)) {
      if (audio && (!Number.isFinite(audio.duration) || source < audio.duration)) pending.push(audio.play().catch(error => {
        // An independently replaced audio source must never stop the picture.
        if (audio.getAttribute('src') && error?.name !== 'AbortError') errorRef.current('声音播放失败，请重试');
      }));
    }
    try { await Promise.all(pending); }
    catch (error) {
      if (playingRef.current && request === playRequest.current) { pause(); errorRef.current(error instanceof Error ? error.message : '播放失败'); }
    }
  }, [pause, sourceTime, whiteboard.sync]);

  const seek = useCallback((time: number) => {
    const active = projectRef.current, video = videoRef.current;
    if (!active || !video) return;
    cadence.current.reset();
    invalidatePresented();
    playRequest.current++;
    const output = Math.max(0, Math.min(time, getOutputDuration(active.clips)));
    timeRef.current = output; setCurrentTime(output);
    const source = outputToSourceTime(active.clips, output);
    clockRef.current.seek(source, video.duration);
    webcam.sync(source, true);
    whiteboard.sync(source, playingRef.current, true);
    if (Number.isFinite(video.duration)) video.currentTime = Math.min(source, Math.max(0, video.duration - 0.001));
    if (clockRef.current.holding) video.pause();
    Object.values(audioRef.current).forEach((audio) => { if (audio && Number.isFinite(audio.duration)) audio.currentTime = Math.min(source, audio.duration); });
    if (playingRef.current) void playMedia();
    draw();
  }, [webcam.sync, whiteboard.sync, playMedia, draw, invalidatePresented]);

  const togglePlay = useCallback(async () => {
    if (playingRef.current) { pause(); return; }
    const active = projectRef.current, video = videoRef.current;
    if (!active || !video || video.readyState < 1) return;
    if (timeRef.current >= getOutputDuration(active.clips) - 0.02) seek(0);
    clockRef.current.play(); playingRef.current = true; setPlaying(true);
    await playMedia();
  }, [pause, seek, playMedia]);

  useEffect(() => {
    pause(); invalidatePresented(); setReady(false); setLoadingError(null); timeRef.current = 0; setCurrentTime(0);
    clockRef.current.reset();
    if (!project?.media.screen) return;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous'; video.preload = 'auto'; video.playsInline = true;
    videoRef.current = video;
    loadedMedia.current = { projectId: project.id, screen: project.media.screen };
    const loaded = () => { setReady(true); seek(0); draw(); };
    const error = () => { invalidatePresented(); setLoadingError('原始视频无法读取，请重新打开工程或导入视频'); pause(); };
    const ended = () => {
      // A VFR file can finish before the project's presentation end. Keep its last frame.
      clockRef.current.ended(video.duration);
    };
    video.addEventListener('loadeddata', loaded);
    video.addEventListener('seeked', draw);
    video.addEventListener('seeking', invalidatePresented);
    video.addEventListener('error', error);
    video.addEventListener('ended', ended);
    video.src = project.media.screen;
    return () => {
      video.pause(); video.removeEventListener('loadeddata', loaded); video.removeEventListener('seeked', draw);
      video.removeEventListener('seeking', invalidatePresented); invalidatePresented();
      video.removeEventListener('error', error); video.removeEventListener('ended', ended);
      video.removeAttribute('src'); video.load(); videoRef.current = null; loadedMedia.current = null;
    };
    // Media is rebuilt only when the project changes; edit properties are read from refs.
  }, [project?.id, project?.media.screen, project?.media.systemAudio, project?.media.microphone, draw, pause, seek, invalidatePresented]);

  const originalAudioPreview = usePreviewAudioTracks(project, audioSource, playing, videoRef, audioRef, sourceTime, onError);

  useEffect(() => {
    if (!project) return;
    draw();
  }, [project, draw]);

  useEffect(() => {
    if (!project) return;
    pause(); seek(Math.min(timeRef.current, getOutputDuration(project.clips)));
  }, [project?.clips, pause, seek]);

  useEffect(() => {
    let animation = 0, lastUiUpdate = 0;
    const tick = (now: number) => {
      // Keep the scheduler alive even if a media setter or decoder fails during synchronization.
      animation = requestAnimationFrame(tick);
      try {
      const active = projectRef.current, video = videoRef.current;
      webcamRef.current = webcam.ref.current;
      if (active && video && playingRef.current && !video.seeking) {
        let publish = false;
        const located = locateClip(active.clips, timeRef.current);
        if (located) {
          const { clip, offset, index } = located;
          const source = sourceTime();
          if (source >= clip.end - 0.005) {
            if (index + 1 < active.clips.length) {
              seek(offset + clip.end - clip.start + 0.00001);
            } else {
              timeRef.current = getOutputDuration(active.clips); setCurrentTime(timeRef.current); pause();
            }
          } else {
            timeRef.current = offset + Math.max(0, source - clip.start);
            webcam.sync(source);
            whiteboard.sync(source, true);
            // Correct only material drift, avoiding audible seek jitter on every animation frame.
            Object.values(audioRef.current).forEach((audio) => {
              if (audio && !audio.seeking && Math.abs(audio.currentTime - source) > 0.12 && !audio.ended) audio.currentTime = Math.min(source, audio.duration || source);
            });
            if (now - lastUiUpdate > 40) { setCurrentTime(timeRef.current); lastUiUpdate = now; publish = true; }
          }
        }
        if (!playingRef.current || cadence.current.take(sourceTime(), active.fps)) draw();
        if (publish) publishPresented();
      }
      } catch (cause) {
        pause(); errorRef.current(cause instanceof Error ? cause.message : '预览同步失败，请重新播放');
      }
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [draw, pause, seek, sourceTime, webcam.ref, webcam.sync, whiteboard.sync, publishPresented]);

  const displayed = displayedPreviewSnapshot(presented?.project, presented?.snapshot, project);
  return { canvasRef, currentTime, playing, ready: ready && audioSource.ready, videoReady: ready,
    presentedSourceTime: displayed?.sourceTime,
    presentedCameraAvailable: Boolean(displayed?.cameraAvailable), interactionSnapshot,
    audioProcessing: !audioSource.ready && !audioSource.error, originalAudioPreview,
    loadingError: loadingError ?? audioSource.error ?? null, seek, togglePlay, pause, draw };
}
