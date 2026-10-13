import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { CameraControls } from '../src/components/recording-overlay/CameraControls';
import { WebcamPanel } from '../src/components/inspector/WebcamPanel';
import { Teleprompter } from '../src/components/recording-overlay/Teleprompter';
import { useTeleprompter } from '../src/hooks/useTeleprompter';
import { DEFAULT_STYLE } from '../shared/constants';
import { DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';
import type { LiveRecordingState, Project, RecordingControlAction } from '../shared/types';

const initial: LiveRecordingState = { status: 'idle', cameraPreviewing: true, cameraMode: 'overlay',
  cameraAvailable: true, cameraVisible: true, cameraSize: .22, cameraShape: 'circle', cameraMirror: true,
  microphoneEnabled: false, microphoneMuted: false, microphoneName: '', systemAudioEnabled: false, systemAudioMuted: false };
const project: Project = { id: 'ui-test', name: 'UI test', createdAt: '2026-09-07T00:00:00Z', duration: 3,
  width: 1920, height: 1080, fps: 30, media: { screen: 'unused', camera: 'unused' }, cursor: [], zooms: [],
  clips: [{ id: 'clip', start: 0, end: 3 }], style: { ...DEFAULT_STYLE }, audio: { microphone: 0, system: 0 },
  camera: { offset: 0, enabled: true, position: 'bottom-right', size: .22, shape: 'circle', mirror: true,
    shrinkOnZoom: false, mode: 'overlay', modeKeyframes: [{ t: 0, mode: 'overlay' }, { t: 1, mode: 'presenter' }, { t: 2, mode: 'overlay' }],
    keyframes: [{ t: 0, x: .82, y: .76, size: .22, shape: 'circle', mirror: true, visible: false }],
    effects: { ...DEFAULT_CAMERA_EFFECTS }, effectKeyframes: [{ t: 0, effects: { ...DEFAULT_CAMERA_EFFECTS, brightness: .61 } }] } };
const actions: RecordingControlAction[] = [];
let live = initial, currentProject = project, hold = false, release: (() => void) | undefined;
let setDisabled: (disabled: boolean) => void, setTime: (time: number) => void;
let patchLive: (patch: Partial<LiveRecordingState>) => void;
let missingCamera: (scenario: 'failed' | 'legacy' | 'none') => void;
function Overlay() {
  const [state, update] = useState(initial), [disabled, disable] = useState(false);
  setDisabled = disable; live = state;
  patchLive = patch => update(previous => ({ ...previous, ...patch }));
  const control = async (action: RecordingControlAction) => {
    actions.push(action);
    if (hold) await new Promise<void>(resolve => { release = resolve; });
    if (action.type === 'camera-mode') update(previous => ({ ...previous, cameraMode: action.value }));
    if (action.type === 'camera-mirror') update(previous => ({ ...previous, cameraMirror: action.value }));
    if (action.type === 'camera-presenter') update(previous => ({ ...previous, cameraPresenter: action.value }));
  };
  const presenter = state.cameraMode === 'presenter';
  const teleprompter = useTeleprompter(state);
  return <div className="camera-overlay-window" style={{ width: presenter ? 652 : 232, height: presenter ? 372 : 232 }}>
    <div className="overlay-camera-frame" style={{ borderRadius: presenter ? 8 : '50%',
      background: 'repeating-linear-gradient(90deg, #a98d71 0 32px, #536d73 32px 64px)' }} />
    <Teleprompter controller={teleprompter} />
    <CameraControls state={state} disabled={disabled} control={control} compact
      teleprompterOpen={teleprompter.visible} onTeleprompterToggle={teleprompter.toggle} />
  </div>;
}
function Editor() {
  const [value, update] = useState(project), [time, updateTime] = useState(1.5);
  currentProject = value; setTime = updateTime;
  missingCamera = scenario => update(previous => ({ ...previous, media: { screen: previous.media.screen },
    camera: scenario === 'none' ? undefined : scenario === 'failed'
      ? { ...previous.camera!, enabled: false, useRecordedMode: true }
      : { ...previous.camera!, mode: undefined, modeKeyframes: undefined, useRecordedMode: undefined } }));
  return <aside className="inspector-panel" style={{ width: 330, height: '100%' }}>
    <div className="inspector-content"><WebcamPanel project={value} sourceTime={time}
      onChange={camera => update(previous => ({ ...previous, camera }))} /></div>
  </aside>;
}
Object.assign(window, { presenterUi: {
  state: () => ({ live, actions, project: currentProject }),
  hold: (value: boolean) => { hold = value; if (!value) { release?.(); release = undefined; } },
  disabled: (value: boolean) => setDisabled(value), time: (value: number) => setTime(value),
  patchLive: (patch: Partial<LiveRecordingState>) => patchLive(patch),
  missingCamera: (scenario: 'failed' | 'legacy' | 'none') => missingCamera(scenario),
} });
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('editor') ? <Editor /> : <Overlay />);
const controls = document.getElementById('fixture-controls');
if (controls) {
  controls.innerHTML = '<button id="fixture-preview">录前预览</button><button id="fixture-countdown">倒计时</button><button id="fixture-recording">录制中</button>';
  controls.querySelector('#fixture-preview')!.addEventListener('click', () => patchLive({ status: 'idle', cameraPreviewing: true, countdown: undefined }));
  controls.querySelector('#fixture-countdown')!.addEventListener('click', () => patchLive({ status: 'idle', cameraPreviewing: true, countdown: 3 }));
  controls.querySelector('#fixture-recording')!.addEventListener('click', () => patchLive({ status: 'recording', cameraPreviewing: false, countdown: undefined }));
}
