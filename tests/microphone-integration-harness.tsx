import { ExportBackground } from './export-background-harness';
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useState } from 'react';
import { useMicrophoneTrial } from '../src/hooks/useMicrophoneTrial';
import { AudioPanel } from '../src/components/inspector/AudioPanel';
import { CanvasPanel } from '../src/components/inspector/CanvasPanel';
import { usePreview } from '../src/hooks/usePreview';
import { microphonePreset, type MicrophoneEffects, type MicrophonePreset } from '../shared/microphone-effects';
import type { Project, RecorderApi, StudioApi } from '../shared/types';

interface Bridge { call: (method: string, ...args: unknown[]) => Promise<unknown> }
const bridge = (window as unknown as { microphoneIntegration: Bridge }).microphoneIntegration;
const call = bridge.call;
const config = { delayStart: 0, delayProcessPreset: '', delayProcess: 0, delayPreparePreset: '', delayPrepare: 0, failPreparePreset: '',
  delayMixVolume: -1, delayMix: 0, holdMixVolume: -1, failMix: false };
const heldMixes: (() => void)[] = [];
const calls: { method: string; preset?: string; url?: string; at: number }[] = [];
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const audioElements: HTMLAudioElement[] = [], NativeAudio = window.Audio;
window.Audio = function (url?: string) { const audio = new NativeAudio(url); audio.muted = true; audioElements.push(audio); return audio; } as unknown as typeof Audio;
window.recorder = {
  releaseAudio: (url: string) => call('releaseAudio', url),
  startMicrophoneTrial: async (device: string) => { const milliseconds = config.delayStart; const result = await call('startTrial', device); await delay(milliseconds); return result; },
  finishMicrophoneTrial: (id: string) => call('finishTrial', id), cancelMicrophoneTrial: (id: string) => call('cancelTrial', id),
  processMicrophoneTrial: async (id: string, effects: MicrophoneEffects) => {
    const milliseconds = config.delayProcessPreset === effects.preset ? config.delayProcess : 0;
    calls.push({ method: 'process-begin', preset: effects.preset, at: performance.now() });
    const url = await call('processTrial', id, effects) as string;
    calls.push({ method: 'process-backend-complete', preset: effects.preset, url, at: performance.now() });
    await delay(milliseconds); calls.push({ method: 'process-return', preset: effects.preset, url, at: performance.now() }); return url;
  },
} as unknown as RecorderApi;
window.studio = {
  releaseAudio: (url: string) => call('releaseAudio', url),
  minimize: () => { void call('minimize'); },
  getStatus: async () => ({ platform: 'linux' }), // Exercise the portable software encoder.
  exportStart: (project: Project, settings: Parameters<StudioApi['exportStart']>[1]) => call('exportStart', project, settings),
  exportAppend: async (id: string, data: ArrayBuffer) => { await delay(15); return call('exportAppend', id, data); },
  exportFinish: (id: string) => call('exportFinish', id),
  exportCancel: (id: string) => call('exportCancel', id),
  cancelExportPreparation: () => call('cancelExportPreparation'),
  prepareAudio: async (id: string, audio: Project['audio']) => {
    const milliseconds = config.delayMixVolume === audio.microphone ? config.delayMix : 0;
    if (config.failMix) throw new Error('Synthetic requested mix failure');
    const released = config.holdMixVolume === audio.microphone
      ? new Promise<void>(resolve => heldMixes.push(resolve)) : Promise.resolve();
    const url = await call('prepareAudio', id, audio) as string;
    calls.push({ method: `mix-backend-${audio.microphone}`, url, at: performance.now() });
    await released;
    await delay(milliseconds); calls.push({ method: `mix-return-${audio.microphone}`, url, at: performance.now() }); return url;
  },
  prepareMicrophone: async (id: string, effects: MicrophoneEffects) => {
    const milliseconds = config.delayPreparePreset === effects.preset ? config.delayPrepare : 0;
    calls.push({ method: 'prepare-begin', preset: effects.preset, at: performance.now() });
    if (config.failPreparePreset === effects.preset) throw new Error('Synthetic requested prepare failure');
    const url = await call('prepareProject', id, effects) as string;
    calls.push({ method: 'prepare-backend-complete', preset: effects.preset, url, at: performance.now() });
    await delay(milliseconds); calls.push({ method: 'prepare-return', preset: effects.preset, url, at: performance.now() }); return url;
  }, cancelMicrophonePreparation: () => call('cancelPreparation'),
} as unknown as StudioApi;

let snapshot: () => unknown = () => ({}), start: () => unknown, finish: () => unknown, play: () => unknown;
let seek: (time: number) => void;
let compare: (value: 'original' | 'effect') => void;
function Trial({ device, enabled, preset }: { device: string; enabled: boolean; preset: MicrophonePreset }) {
  const trial = useMicrophoneTrial(device, enabled, microphonePreset(preset));
  snapshot = () => ({ phase: trial.phase, sample: trial.sample, processing: trial.processing, playing: trial.playing,
    canPlay: trial.canPlay, elapsed: trial.elapsed, error: trial.error, comparison: trial.comparison });
  start = trial.start; finish = trial.finish; play = trial.play; compare = trial.compare;
  return <output>{trial.phase}</output>;
}
function Preview({ project }: { project: Project | null }) {
  const [errors, setErrors] = useState<string[]>([]);
  const onError = useCallback((message: string) => setErrors(previous => [...previous, message]), []);
  const preview = usePreview(project, onError);
  snapshot = () => ({ ready: preview.ready, videoReady: preview.videoReady, audioProcessing: preview.audioProcessing,
    originalAudioPreview: preview.originalAudioPreview, playing: preview.playing, currentTime: preview.currentTime, errors, project });
  play = preview.togglePlay; seek = preview.seek;
  return <canvas ref={preview.canvasRef} style={{ width: 320, height: 180 }} />;
}
function Harness() {
  const [mode, setMode] = useState('trial'), [device, setDevice] = useState('synthetic-a'), [enabled, setEnabled] = useState(true);
  const [preset, setPreset] = useState<MicrophonePreset>('natural'), [project, setProject] = useState<Project | null>(null);
  useEffect(() => { void call('project').then(value => setProject(value as Project)); }, []);
  Object.assign(window, { microphoneTest: {
    state: () => ({ mode, device, enabled, preset, project, view: snapshot(), calls,
      audio: audioElements.map(element => ({ src: element.getAttribute('src'), currentSrc: element.currentSrc, paused: element.paused,
        readyState: element.readyState, currentTime: element.currentTime, volume: element.volume, muted: element.muted })) }),
    configure: (patch: Partial<typeof config>) => Object.assign(config, patch), call,
    releaseMix: () => { for (const release of heldMixes.splice(0)) release(); },
    mode: setMode, device: setDevice, enabled: setEnabled,
    dual: async () => { setProject(await call('dualProject') as Project); setMode('preview'); },
    seek: (time: number) => seek(time),
    style: (style: Partial<Project['style']>) => setProject(previous => previous && { ...previous, style: { ...previous.style, ...style } }),
    levels: (audio: { system: number; microphone: number }) => setProject(previous => previous && { ...previous, audio: { ...previous.audio, ...audio } }),
    effects: (next: MicrophonePreset) => { setPreset(next); if (mode === 'preview') setProject(previous => previous && { ...previous, audio: { ...previous.audio, microphoneEffects: microphonePreset(next) } }); },
    start: () => start(), finish: () => finish(), play: () => play(), compare: (value: 'original' | 'effect') => compare(value),
    save: async () => { if (project) { const saved = await call('saveProject', project); setProject(saved as Project); return saved; } },
  } });
  return mode === 'trial' ? <Trial device={device} enabled={enabled} preset={preset} />
    : mode === 'export' && project ? <ExportBackground project={project} /> : mode === 'preview' ? <div style={{ height: '100%', overflow: 'auto' }}><Preview project={project} />{project && <><AudioPanel project={project} onChange={audio => setProject({ ...project, audio })} /><CanvasPanel style={project.style} onChange={style => setProject({ ...project, style: { ...project.style, ...style } })} /></>}</div> : <div>Unmounted</div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
