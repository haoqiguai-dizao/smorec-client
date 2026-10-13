import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MicrophoneEffectsControls } from '../src/components/microphone-effects/MicrophoneEffectsControls';
import { useProjectAudio } from '../src/hooks/useProjectAudio';
import { usePreviewAudioTracks } from '../src/hooks/usePreviewAudioTracks';
import { microphonePreset } from '../shared/microphone-effects';
import type { Project, StudioApi } from '../shared/types';
import type { PreviewAudioElements } from '../src/services/preview-audio-session';
import './audio-preview-isolation-ui-harness.css';

const base = '/output/audio-preview-isolation-20261007/';
const behavior = { delay: true, fail: false };
const wait = () => new Promise(resolve => setTimeout(resolve, behavior.delay ? 900 : 0));
const NativeAudio = window.Audio;
window.Audio = function (url?: string) {
  const audio = new NativeAudio(url); audio.muted = true; audio.loop = true;
  document.getElementById('decoded-tracks')!.append(audio); return audio;
} as unknown as typeof Audio;
window.studio = {
  prepareMicrophone: async (_id, effects) => {
    await wait(); if (behavior.fail) throw new Error('模拟效果处理失败，保留当前声音');
    return `${base}microphone-${effects.enabled ? effects.preset : 'original'}.wav`;
  },
  prepareAudio: async (_id, audio) => {
    await wait(); if (behavior.fail) throw new Error('模拟混音失败，保留当前声音');
    const preset = audio.microphoneEffects?.enabled ? audio.microphoneEffects.preset : 'original';
    return `${base}${!audio.system ? !audio.microphone ? 'silence' : `microphone-${preset}` : !audio.microphone ? 'mix-system-only' : `mix-${preset}`}.wav`;
  }, cancelMicrophonePreparation: async () => {},
} as StudioApi;

function Harness() {
  const [project, setProject] = useState({ id: 'isolation', duration: 4,
    media: { screen: '', systemAudio: `${base}system.wav`, microphone: `${base}microphone.wav` },
    audio: { system: 1, microphone: 1, microphoneEffects: microphonePreset('natural') } } as Project);
  const [playing, setPlaying] = useState(false), [errors, setErrors] = useState<string[]>([]);
  const [delayed, setDelayed] = useState(true), [failed, setFailed] = useState(false);
  const onError = useCallback((error: string) => setErrors(previous => [...previous.slice(-4), error]), []);
  const prepared = useProjectAudio(project, onError);
  const video = useRef(document.createElement('video')), tracks = useRef<PreviewAudioElements>({});
  const clock = useRef({ began: 0, offset: 0, playing: false });
  const time = useCallback(() => (clock.current.offset + (clock.current.playing ? (performance.now() - clock.current.began) / 1000 : 0)) % 4, []);
  usePreviewAudioTracks(project, prepared, playing, video, tracks, time, onError);
  useEffect(() => {
    const timer = setInterval(() => document.querySelectorAll<HTMLAudioElement>('#decoded-tracks audio').forEach(audio => {
      audio.dataset.volume = String(audio.volume);
    }), 50);
    return () => clearInterval(timer);
  }, []);
  const toggle = () => {
    clock.current = { began: performance.now(), offset: time(), playing: !playing }; setPlaying(!playing);
  };
  return <main>
    <div id="decoded-tracks" hidden />
    <header><h1>麦克风效果 · 预览隔离验证</h1><p>两路合成样本，静音解码，不使用录音设备</p></header>
    <div className="fixture-actions">
      <button onClick={toggle}>{playing ? '暂停预览' : '播放预览'}</button>
      <button onClick={() => { behavior.delay = !delayed; setDelayed(!delayed); }}>处理延迟：{delayed ? '开' : '关'}</button>
      <button onClick={() => { behavior.fail = !failed; setFailed(!failed); }}>模拟失败：{failed ? '开' : '关'}</button>
      <button onClick={() => setProject(previous => ({ ...previous, audio: { ...previous.audio, microphone: previous.audio.microphone ? 0 : 1 } }))}>麦克风{project.audio.microphone ? '静音' : '恢复'}</button>
    </div>
    <output data-ready={prepared.ready} data-processing={!prepared.ready && !prepared.error}>
      {prepared.error ? '处理失败 · 保留已确认声音' : prepared.ready ? '效果已就绪' : '新效果处理中 · 保留已确认声音'}
      <span>系统音：原始独立音轨</span>
    </output>
    <section className="fixture-panel"><h2>麦克风</h2>
      <MicrophoneEffectsControls value={project.audio.microphoneEffects!}
        onChange={microphoneEffects => setProject(previous => ({ ...previous, audio: { ...previous.audio, microphoneEffects } }))} />
    </section>
    {errors.length > 0 && <aside role="alert">{errors.at(-1)}</aside>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
