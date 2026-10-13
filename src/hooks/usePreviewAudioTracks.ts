import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Project } from '../../shared/types';
import { PreviewAudioSession, type PreparedPreviewAudio, type PreviewAudioElements } from '../services/preview-audio-session';
import { retainAudioUrl } from '../services/audio-url-leases';

export function usePreviewAudioTracks(project: Project | null, prepared: PreparedPreviewAudio, playing: boolean,
  video: RefObject<HTMLVideoElement | null>, tracks: RefObject<PreviewAudioElements>,
  sourceTime: () => number, onError: (message: string) => void) {
  const error = useRef(onError); error.current = onError;
  const session = useRef<PreviewAudioSession | null>(null);
  const [original, setOriginal] = useState(false);
  useLayoutEffect(() => {
    const current = new PreviewAudioSession(sourceTime, message => error.current(message), undefined, () => setOriginal(current.original), retainAudioUrl);
    session.current = current;
    return () => { current.dispose(); tracks.current = {}; session.current = null; };
  }, [project?.id, project?.media.screen, project?.media.systemAudio, project?.media.microphone, sourceTime, tracks]);
  useLayoutEffect(() => {
    const current = session.current;
    if (!project || !current) return;
    current.update(project, { mixed: prepared.mixed, url: prepared.url, microphoneUrl: prepared.microphoneUrl, ready: prepared.ready }, playing);
    tracks.current = current.tracks;
    if (video.current) current.applyLevels(video.current, project.audio);
    setOriginal(current.original);
  }, [project, prepared.mixed, prepared.url, prepared.microphoneUrl, prepared.ready, playing, video, tracks]);
  return original;
}
