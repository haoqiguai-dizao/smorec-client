// Controlled UI states only. Physical capture, installation and network output remain forbidden.
import './launcher-session-ui-harness';
import type { LiveRecordingState, RecordingControlAction, RecordingOverlayApi } from '../shared/types';
import type { DistributionSnapshot } from '../shared/distribution-types';
import type { BoardSnapshot, WhiteboardApi } from '../shared/whiteboard/types';

let emitOverlay: (state: LiveRecordingState) => void = () => {};
const actions: RecordingControlAction[] = [];
let overlay: LiveRecordingState = { status: 'idle', cameraAvailable: true, cameraVisible: true, cameraShape: 'circle',
  cameraSize: .22, cameraMirror: true, microphoneEnabled: true, microphoneMuted: false, microphoneName: '测试麦克风',
  systemAudioEnabled: true, systemAudioMuted: false, elapsed: 12 };
window.recordingOverlay = {
  getState: async () => overlay, onState: callback => { emitOverlay = callback; return () => {}; },
  control: async action => {
    actions.push(action);
    if (action.type === 'microphone-muted') overlay = { ...overlay, microphoneMuted: action.value };
    if (action.type === 'system-muted') overlay = { ...overlay, systemAudioMuted: action.value };
    if (action.type === 'camera-visible') overlay = { ...overlay, cameraVisible: action.value };
    emitOverlay(overlay);
  },
  setExpanded: async () => {}, setCameraSettings: async () => {},
  previewReady: async () => ({ sessionId: 'ui-only' }), sendPreviewSignal: async () => {}, onPreviewSignal: () => () => {},
} satisfies RecordingOverlayApi;
let demos = 0, boards = 0, boardModes = 0;
window.demo = { getState: async () => ({ enabled: false, visible: true, active: false, ready: true, busy: false, desktopHidden: false, shortcutAvailable: true }),
  menu: async () => { demos++; }, onState: () => () => {} };
const board: BoardSnapshot = { session: 'ui-only', available: true, visible: false, events: [], presentation: 'canvas' };
window.whiteboard = { snapshot: async () => board, onState: () => () => {},
  setVisible: async () => { boards++; }, choosePresentation: async () => { boardModes++; },
} as unknown as WhiteboardApi;
const update: DistributionSnapshot = { update: { status: 'ready', currentVersion: '0.9.76', version: '0.9.77' }, telemetry: { consent: 'unselected', enabled: false } };
window.distribution = { state: async () => update, check: async () => {}, restart: async () => {},
  setTelemetry: async () => update, onChanged: () => () => {} };
Object.assign(window, { floatingUi: {
  recording: (status: LiveRecordingState['status'] | boolean) => {
    overlay = { ...overlay, status: typeof status === 'boolean' ? status ? 'recording' : 'idle' : status };
    emitOverlay(overlay);
  },
  state: () => ({ actions, demos, boards, boardModes }),
} });
