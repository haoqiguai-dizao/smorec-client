import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { LauncherPanel } from '../src/components/recorder-launcher/LauncherPanel';
import { LauncherToolbar } from '../src/components/recorder-launcher/LauncherToolbar';
import type { LauncherPanel as Panel, RecorderLauncherModel } from '../src/hooks/useRecorderLauncher';
import type { RecorderApi } from '../shared/types';
import { microphonePreset } from '../shared/microphone-effects';

let trialStarts = 0;
window.recorder = { startMicrophoneTrial: async () => { trialStarts++; throw new Error('Physical capture is disabled in this layout test'); },
  cancelMicrophoneTrial: async () => {}, quit: async () => {} } as unknown as RecorderApi;
function Harness() {
  const [panel, setPanel] = useState<Panel>('microphone'), [microphone, setMicrophone] = useState(true);
  const [device, setDevice] = useState(''), [effects, setEffects] = useState(microphonePreset('natural'));
  Object.assign(window, { launcherMicrophoneUi: { state: () => ({ panel, microphone, device, effects, trialStarts }) } });
  const model = { panel, setPanel, microphone, setMicrophone, microphoneDeviceId: device, setMicrophoneDeviceId: setDevice,
    microphoneEffects: effects, setMicrophoneEffects: setEffects, microphones: [{ id: 'synthetic-microphone', name: '测试麦克风', isDefault: true }],
    loadingMicrophones: false, microphoneError: undefined, refreshMicrophones: async () => {}, clearError: () => {},
    busy: false, error: undefined, state: { status: 'idle' }, countdown: null, canStart: true, mode: 'screen', systemAudio: true,
    status: { nativeAvailable: true, version: 'layout-only' },
    camera: { enabled: false, loading: false, onEnabledChange: () => {} },
    chooseMode: () => {}, setSystemAudio: () => {}, start: async () => {} } as unknown as RecorderLauncherModel;
  return <div className="recorder-launcher"><LauncherPanel model={model} /><LauncherToolbar model={model} /></div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
