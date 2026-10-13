import { globalShortcut, type BrowserWindow } from 'electron';
import type { RecordingController } from '../recording';
import type { RecorderLauncher } from '../recorder-launcher';
import type { RecordingHud } from '../recording-hud';
import { diagnostic } from '../diagnostics';
import { LiveSession } from './session';
import { installLiveIpc } from './ipc';
import { LiveCameraControls } from './camera-controls';
import type { LiveApplication } from '../../../shared/live-types';
import { captureWindowHandle } from '../platform/capture-runtime';
import { streamProfiles } from '../streaming/store';
import { StreamWriter } from '../streaming/writer';
import { ffmpegPath } from '../ffmpeg';
import { resolveSystemStreamProxy } from '../streaming/system-proxy';
import type { WhiteboardWindow } from '../whiteboard/window';
import { LiveWhiteboard } from './whiteboard';

interface Options {
  recording: RecordingController; launcher: RecorderLauncher; hud: RecordingHud; whiteboard: WhiteboardWindow;
  editor(): BrowserWindow | undefined; idle(): boolean; quitting(): boolean;
  suspendAudio(): Promise<void>; changed(): void;
  applications(): Promise<LiveApplication[]>;
  demo?: { prepare(sourceId: string): void; enabled(): boolean;
    captureOptions(): { captureOwnApp: boolean; ownAppVisible: boolean }; status(status: string): void };
}
export function createLiveIntegration(options: Options) {
  const { launcher, recording, hud } = options;
  const ownedShortcuts = new Set<string>();
  const board = new LiveWhiteboard(recording.whiteboard, options.whiteboard);
  const showControls = () => { hud.setPresentationHidden(false); launcher.showControls(); };
  const hideControls = () => { hud.setPresentationHidden(true); launcher.hide(); };
  const cameraControls = new LiveCameraControls({
    ready: () => session.state.status === 'live', controls: recording.controls,
    show: showControls, openSettings: () => hud.setCameraSettings(true), effectsChanged: effects => launcher.cameraEffects(effects),
  });
  const updateShortcuts = (active: boolean) => {
    if (!active) {
      for (const key of ownedShortcuts) globalShortcut.unregister(key);
      ownedShortcuts.clear(); return;
    }
    for (const [key, callback] of [
      ['CommandOrControl+Shift+L', toggleControls],
      ['CommandOrControl+Shift+0', () => action('reset-zoom')],
      ['CommandOrControl+Alt+Shift+Z', () => action('toggle-auto-zoom')],
    ] as const) {
      if (ownedShortcuts.has(key)) continue;
      if (globalShortcut.register(key, callback)) ownedShortcuts.add(key);
      else diagnostic('live.shortcut-unavailable', key);
    }
  };
  const session = new LiveSession({
    streamProfile: id => streamProfiles.read(id),
    streamOutput: (profile, changed, failed) => new StreamWriter({ executable: ffmpegPath(), profile, changed, failed,
      resolveProxy: resolveSystemStreamProxy,
      diagnostic: message => diagnostic('stream.failure', new Error(message)) }),
    idle: options.idle, sources: () => recording.sources(), camera: () => recording.controls.snapshot(),
    demoOptions: () => options.demo?.captureOptions() ?? { captureOwnApp: false, ownAppVisible: false },
    started: timestamp => board.started(timestamp), whiteboard: () => board.pull(),
    prepare: async (source, capture) => {
      await options.suspendAudio();
      options.demo?.prepare(session.sourceId!);
      hud.setCameraSettings(false); hud.setPresentationHidden(false);
      const boardHandle = await board.prepare(source, capture);
      if (options.demo?.enabled()) return boardHandle ? [boardHandle] : [];
      options.editor()?.hide();
      const handles = Object.values(hud.getWindowHandles()).filter((value): value is string => Boolean(value));
      if (boardHandle) handles.push(boardHandle);
      for (const window of [launcher.getWindow(), options.editor()]) {
        if (!window || window.isDestroyed()) continue;
        const handle = window.getNativeWindowHandle();
        const id = captureWindowHandle(handle, process.platform);
        if (id) handles.push(id);
      }
      return handles;
    },
    restore: async () => {
      await board.restore().catch(error => diagnostic('live.whiteboard-restore-failed', error));
      await cameraControls.restore();
      hud.setLivePresentation(false);
      hud.setPresentationHidden(false);
      if (!options.quitting()) launcher.showControls();
    },
    changed: state => {
      options.demo?.status(state.status);
      hud.setLivePresentation(state.status === 'live');
      updateShortcuts(['starting', 'live', 'stopping'].includes(state.status));
      try { launcher.getWindow()?.webContents.send('live:state', state); }
      finally { options.changed(); }
    },
  });
  const toggleControls = () => { if (session.active()) { if (launcher.isVisible()) hideControls(); else showControls(); } };
  const action = (name: string) => { if (session.state.status === 'live') launcher.getWindow()?.webContents.send('live:action', name); };
  return {
    session, toggleControls, showControls, cameraControls,
    install: () => {
      installLiveIpc(launcher, session, options.idle, hideControls, options.applications);
    },
  };
}
