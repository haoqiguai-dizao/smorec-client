import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useState } from 'react';
import { usePreview } from '../src/hooks/usePreview';
import type { Project } from '../shared/types';

const videos: HTMLVideoElement[] = [], events: unknown[] = [], samples: unknown[] = [];
const originalCreate = document.createElement.bind(document) as (tag: string, options?: ElementCreationOptions) => HTMLElement;
const mediaState = (video: HTMLVideoElement) => ({ src: video.src, currentTime: video.currentTime, duration: video.duration,
  readyState: video.readyState, ended: video.ended, paused: video.paused, seeking: video.seeking, networkState: video.networkState });
document.createElement = ((tag: string, options?: ElementCreationOptions) => {
  const result = originalCreate(tag, options);
  if (tag === 'video') {
    const video = result as HTMLVideoElement; videos.push(video);
    for (const name of ['loadeddata', 'loadedmetadata', 'seeked', 'ended', 'pause', 'playing', 'waiting', 'error'])
      video.addEventListener(name, () => events.push({ at: performance.now(), event: name, ...mediaState(video) }));
  }
  return result;
}) as typeof document.createElement;
const bridge = (window as unknown as { microphoneIntegration: { call: (method: string) => Promise<Project> } }).microphoneIntegration;
function Harness() {
  const [project, setProject] = useState<Project | null>(null), [errors, setErrors] = useState<string[]>([]);
  const error = useCallback((message: string) => setErrors(previous => [...previous, message]), []);
  const preview = usePreview(project, error);
  useEffect(() => { void bridge.call('project').then(setProject); }, []);
  const state = () => ({ project: project && { id: project.id, duration: project.duration, clips: project.clips },
    ready: preview.ready, playing: preview.playing, currentTime: preview.currentTime, errors,
    canvas: [...document.querySelectorAll('canvas')].map(canvas => ({ className: canvas.className, ...canvas.dataset })), videos: videos.map(mediaState) });
  Object.assign(window, { previewTail: { state, events, samples, play: preview.togglePlay, pause: preview.pause,
    seek: preview.seek, draw: preview.draw, clone: () => setProject(previous => previous && structuredClone(previous)) } });
  useEffect(() => { const timer = setInterval(() => {
    const probe = (window as unknown as { previewTail: { state: typeof state } }).previewTail;
    samples.push({ at: performance.now(), ...probe.state() }); if (samples.length > 500) samples.shift();
  }, 50); return () => clearInterval(timer); }, []);
  return <><canvas ref={preview.canvasRef} className="preview-canvas" style={{ width: 960, height: 540 }} />
    <button aria-label={preview.playing ? '暂停' : '播放'} onClick={() => void preview.togglePlay()}>Play</button></>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
