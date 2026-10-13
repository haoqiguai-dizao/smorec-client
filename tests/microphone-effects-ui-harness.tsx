import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { MicrophoneEffectsControls } from '../src/components/microphone-effects/MicrophoneEffectsControls';
import { AudioPanel } from '../src/components/inspector/AudioPanel';
import { microphonePreset, normalizeMicrophoneEffects } from '../shared/microphone-effects';
import { DEFAULT_STYLE } from '../shared/constants';
import type { Project } from '../shared/types';

const project: Project = { id: 'microphone-ui', name: 'Synthetic microphone UI', createdAt: '', duration: 3,
  width: 1920, height: 1080, fps: 30, media: { screen: 'unused', microphone: 'unused', systemAudio: 'unused' },
  cursor: [], zooms: [], clips: [{ id: 'clip', start: 0, end: 3 }], style: DEFAULT_STYLE,
  audio: { microphone: .65, system: .4 } };
function Harness() {
  const [value, setValue] = useState(microphonePreset('natural')), [disabled, setDisabled] = useState(false);
  const [width, setWidth] = useState(620), [current, setProject] = useState(project);
  Object.assign(window, { microphoneUi: { state: () => ({ value, disabled, project: current }),
    disable: setDisabled, width: setWidth, legacy: () => setValue(normalizeMicrophoneEffects(undefined)) } });
  return <main id="microphone-fixture" style={{ width, padding: 0, margin: 24, background: '#202226' }}>
    {new URLSearchParams(location.search).has('inspector')
      ? <AudioPanel project={current} onChange={audio => setProject(previous => ({ ...previous, audio }))} />
      : <MicrophoneEffectsControls value={value} disabled={disabled} onChange={setValue} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
