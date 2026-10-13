import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useState } from 'react';
import { usePreview } from '../src/hooks/usePreview';
import { exportVideo } from '../src/services/export-video';
import type { Clip, Project, StudioApi } from '../shared/types';

const bridge = (window as unknown as { previewTestApi: { project: () => Promise<Project>; studio: StudioApi } }).previewTestApi;
const videos: HTMLVideoElement[] = [], audio: HTMLAudioElement[] = [];
const create = document.createElement.bind(document) as (tag: string, options?: ElementCreationOptions) => HTMLElement;
document.createElement = ((tag: string, options?: ElementCreationOptions) => {
  const element = create(tag, options);
  if (tag === 'video') videos.push(element as HTMLVideoElement);
  return element;
}) as typeof document.createElement;
window.Audio = new Proxy(Audio, { construct(Target, args) {
  const element = Reflect.construct(Target, args) as HTMLAudioElement; audio.push(element); return element;
} });
const media = (element?: HTMLMediaElement) => element && ({
  time: element.currentTime, duration: element.duration, ended: element.ended, paused: element.paused,
});
const fingerprintCanvas = document.createElement('canvas'); fingerprintCanvas.width = 32; fingerprintCanvas.height = 18;
function fingerprint(video?: HTMLVideoElement) {
  if (!video || video.readyState < 2) return '';
  fingerprintCanvas.getContext('2d')!.drawImage(video, 0, 0, 32, 18);
  return fingerprintCanvas.toDataURL();
}
function Harness() {
  const [project, setProject] = useState<Project | null>(null), [errors, setErrors] = useState<string[]>([]);
  const onError = useCallback((message: string) => setErrors(previous => [...previous, message]), []);
  const preview = usePreview(project, onError);
  useEffect(() => { void bridge.project().then(setProject); }, []);
  const screen = () => videos.find(video => video.src === project?.media.screen);
  const camera = () => videos.find(video => video.src === project?.media.camera);
  const state = () => ({
    currentTime: preview.currentTime, source: Number(preview.canvasRef.current?.dataset.sourceTime ?? 0),
    playing: preview.playing, errors, hidden: document.hidden, screen: media(screen()), camera: media(camera()),
    audio: media(audio.find(element => element.src === project?.media.systemAudio)), fingerprint: fingerprint(screen()),
  });
  Object.assign(window, { previewTail: {
    state, ready: () => preview.ready && (screen()?.readyState ?? 0) >= 2 && (camera()?.readyState ?? 0) >= 2,
    play: preview.togglePlay, pause: preview.pause, seek: preview.seek,
    clips: (clips: Clip[]) => setProject(previous => previous && { ...previous, clips }),
    export: () => project && exportVideo(bridge.studio, project, () => {}, new AbortController().signal),
  } });
  return <div className="canvas-viewport" style={{ width: 640, height: 360, padding: 0 }}>
    <canvas className="preview-canvas" ref={preview.canvasRef} />
  </div>;
}
createRoot(document.getElementById('app')!).render(<Harness />);
