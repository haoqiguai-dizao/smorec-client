// Full RecorderLauncher fixture; test state controls never access physical devices.
import './floating-launcher-ui-harness';
import '../src/styles/recorder-launcher.css';
import '../src/styles/capture-theme.css';

let quits = 0;
window.toolbarPresentation = { setRegions: async () => {}, quit: async () => {
  quits++; document.documentElement.dataset.quits = String(quits); return false;
} };
const fixture = (window as unknown as { launcherSessionFixture: { recording(state: string): void; live(state: string): void } }).launcherSessionFixture;
const overlay = (window as unknown as { floatingUi: { recording(state: string): void } }).floatingUi;
const controls = document.getElementById('fixture-controls')!;
for (const [label, action] of [
  ['模拟录制', () => { overlay.recording('recording'); fixture.recording('recording'); }],
  ['模拟停止', () => { overlay.recording('idle'); fixture.recording('idle'); fixture.live('idle'); }],
  ['模拟直播', () => fixture.live('live')],
] as const) {
  const button = document.createElement('button'); button.textContent = label; button.onclick = action; controls.append(button);
}

const recordingControl = window.recordingOverlay!.control;
window.recordingOverlay!.control = async action => {
  document.documentElement.dataset.lastControl = action.type;
  await recordingControl(action);
  if (action.type === 'stop') { overlay.recording('idle'); fixture.recording('idle'); }
};
