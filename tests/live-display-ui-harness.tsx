import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useLiveSession } from '../src/hooks/useLiveSession';
import { LivePreviewSettings } from '../src/components/recorder-launcher/LivePreviewSettings';
import type { LiveState } from '../shared/live-types';
import type { RecorderLauncherModel } from '../src/hooks/useRecorderLauncher';
import { DEFAULT_STYLE } from '../shared/constants';
import { DEFAULT_STREAM_ENCODING } from '../shared/streaming';
import '../src/styles/recorder-launcher.css';
import '../src/styles/live.css';
import '../src/components/recorder-launcher/live-workflow.css';
import { LIVE_RUNTIME_ISSUES } from '../shared/live-issues';

const callbacks = new Set<(state: LiveState) => void>();
let frames = 0, started = 0, state: LiveState = { status: 'idle' };
const profile = { ...DEFAULT_STREAM_ENCODING, id: 'owned-ui', name: '预览优化测试', server: 'rtmp://example.invalid/live', key: 'owned-ui-only' };
const publish = (next: LiveState) => { state = next; callbacks.forEach(callback => callback(next)); };
window.live = {
  profiles: { list: async () => [profile], read: async () => profile, save: async () => profile, remove: async () => {} },
  applications: async () => [], status: async () => ({ available: true, installed: false, name: 'Owned UI fixture' }),
  install: async () => { throw new Error('System installation is forbidden in this fixture'); },
  start: async () => {
    frames = 0; started = performance.now();
    publish({ status: 'live', phase: 'preview', id: 'owned-ui', output: 'stream' });
    return { id: 'owned-ui', width: 1920, height: 1080, fps: 30, style: DEFAULT_STYLE };
  },
  pull: async () => {
    const pixels = new Uint8Array(320 * 180 * 4);
    for (let at = 0; at < pixels.length; at += 4) { pixels[at] = frames * 5 % 255; pixels[at + 1] = 120; pixels[at + 2] = 220; pixels[at + 3] = 255; }
    return { width: 320, height: 180, time: (performance.now() - started) / 1000, pixels,
      input: [], audioLevel: .2, camera: { status: 'idle', cameraAvailable: false, cameraVisible: false,
        cameraShape: 'circle', cameraSize: .22, cameraMirror: false, microphoneEnabled: false, microphoneMuted: false,
        microphoneName: '', systemAudioEnabled: false, systemAudioMuted: false },
      placement: { x: .8, y: .8 }, shrinkOnZoom: false };
  },
  push: async (_id, pixels) => { if (pixels.byteLength !== 1920 * 1080 * 4) throw new Error('Output size changed'); frames++; },
  broadcast: async () => publish({ status: 'live', phase: 'broadcast', id: 'owned-ui', output: 'stream',
    connection: { status: 'streaming', attempt: 0, frames: 1, bitrate: 4500, dropped: 0 } }),
  stop: async () => publish({ status: 'idle' }), hideControls: async () => {}, setExcludedApplications: async () => {},
  report: async (id, issue) => {
    if (id !== state.id || state.status !== 'live') throw new Error('Owned fixture session ended');
    publish({ ...state, error: LIVE_RUNTIME_ISSUES[issue].message });
  },
  onState: callback => { callbacks.add(callback); return () => { callbacks.delete(callback); }; },
  onAction: () => () => {},
};
const model = { busy: false, selected: { id: 'screen:owned', name: '合成测试画面', kind: 'screen', width: 320, height: 180 },
  sources: [{ id: 'screen:owned', name: '合成测试画面', kind: 'screen', width: 320, height: 180 }], panel: null,
  mode: 'screen', camera: { enabled: false, loading: false }, microphone: true, systemAudio: true,
  loadingMicrophones: false, microphones: [], setPanel: () => {}, clearError: () => {},
} as unknown as RecorderLauncherModel;
function Harness() {
  const live = useLiveSession(() => null);
  const [outputFrames, setOutputFrames] = useState(0);
  useEffect(() => { const timer = setInterval(() => setOutputFrames(frames), 100); return () => clearInterval(timer); }, []);
  return <main className="recorder-launcher" style={{ width: 440, height: 'auto', alignItems: 'stretch', padding: 18, margin: '20px auto', background: 'white', color: '#303d53' }}>
    <LivePreviewSettings live={live} model={model} ready={live.profiles.ready && live.applications.ready}
      start={() => void live.start({ sourceId: 'screen:owned', preview: true, output: 'stream' })} back={() => {}} changeConnection={() => {}} />
    <output aria-label="隔离验收状态" data-frames={outputFrames} data-phase={state.phase ?? state.status}
      data-preview-enabled={live.previewEnabled} data-ready={live.previewReady} data-audio={live.audioLevel}>
      合成测试 · 输出 {outputFrames} 帧
    </output>
    {live.error && <p role="alert">{live.error}</p>}
    <button onClick={() => void window.live?.report?.('owned-ui', 'camera-unavailable')}>模拟人物画面中断</button>
    <button onClick={() => void window.live?.report?.('owned-ui', 'camera-restored')}>模拟人物画面恢复</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
