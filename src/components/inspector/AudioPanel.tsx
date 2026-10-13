import { AudioLines, Mic } from 'lucide-react';
import type { Project } from '../../../shared/types';
import { Section, Slider } from './Controls';
import { normalizeMicrophoneEffects } from '../../../shared/microphone-effects';
import { MicrophoneEffectsControls } from '../microphone-effects/MicrophoneEffectsControls';

export function AudioPanel({ project, onChange }: { project: Project; onChange: (audio: Project['audio']) => void }) {
  return <>
    <Section title="系统声音">
      <div className="audio-track-label"><AudioLines size={17} /><span>{project.media.systemAudio ? '系统音轨' : '无系统音轨'}</span></div>
      <Slider label="音量" value={Math.round(project.audio.system * 100)} min={0} max={100} unit="%" disabled={!project.media.systemAudio}
        onChange={system => onChange({ ...project.audio, system: system / 100 })} />
    </Section>
    <Section title="麦克风">
      <div className="audio-track-label"><Mic size={17} /><span>{project.media.microphone ? '麦克风音轨' : '无麦克风音轨'}</span></div>
      <Slider label="音量" value={Math.round(project.audio.microphone * 100)} min={0} max={100} unit="%" disabled={!project.media.microphone}
        onChange={microphone => onChange({ ...project.audio, microphone: microphone / 100 })} />
      <MicrophoneEffectsControls value={normalizeMicrophoneEffects(project.audio.microphoneEffects)} disabled={!project.media.microphone}
        onChange={microphoneEffects => onChange({ ...project.audio, microphoneEffects })} />
    </Section>
  </>;
}
