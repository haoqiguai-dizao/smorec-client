import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { LauncherPanel } from '../src/components/recorder-launcher/LauncherPanel';
import { LauncherToolbar } from '../src/components/recorder-launcher/LauncherToolbar';
import type { LauncherPanel as Panel, RecorderLauncherModel } from '../src/hooks/useRecorderLauncher';

function Harness() {
  const [panel, setPanel] = useState<Panel>(null);
  const model = { panel, setPanel, clearError: () => {}, busy: false, error: undefined, state: { status: 'idle' },
    countdown: null, canStart: false, mode: 'screen', systemAudio: false, microphone: false,
    status: { nativeAvailable: true, version: 'cache-test' }, resolution: '1440p', fps: 30,
    camera: { enabled: false, loading: false, onEnabledChange: () => {} },
    chooseMode: () => {}, setSystemAudio: () => {}, start: async () => {}, openEditor: async () => {} } as unknown as RecorderLauncherModel;
  return <div className="recorder-launcher"><LauncherPanel model={model} /><LauncherToolbar model={model} /></div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
