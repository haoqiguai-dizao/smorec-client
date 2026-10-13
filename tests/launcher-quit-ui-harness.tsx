import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LauncherToolbar } from '../src/components/recorder-launcher/LauncherToolbar';
import type { RecorderLauncherModel } from '../src/hooks/useRecorderLauncher';
import type { RecorderApi, RecordingState } from '../shared/types';

let quitCount = 0;
window.recorder = { quit: () => { quitCount++; } } as unknown as RecorderApi;
function Harness() {
  const [state, update] = useState<RecordingState>({ status: 'idle' }), [countdown, setCountdown] = useState<number | null>(null);
  const busy = countdown !== null || ['starting', 'recording', 'stopping'].includes(state.status);
  Object.assign(window, { launcherQuitUi: { quitCount: () => quitCount,
    state: (status: RecordingState['status'], counter: number | null = null) => { update({ status }); setCountdown(counter); } } });
  const model = { state, busy, countdown, canStart: !busy, panel: null, mode: 'screen', microphone: true, systemAudio: true,
    loadingMicrophones: false, camera: { enabled: true, loading: false, stream: new MediaStream() },
    chooseMode: () => {}, setPanel: () => {}, setMicrophone: () => {}, setSystemAudio: () => {},
    cancelCountdown: () => setCountdown(null), start: async () => {} } as unknown as RecorderLauncherModel;
  return <div className="recorder-launcher"><LauncherToolbar model={model} /></div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
