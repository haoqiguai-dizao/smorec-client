import { screen, dialog, type BrowserWindow } from 'electron';
import type { Project, RecordingState } from '../../../shared/types';
import type { RecordingController } from '../recording';
import type { RecorderLauncher } from '../recorder-launcher';
import type { RecordingHud } from '../recording-hud';
import type { WhiteboardWindow } from '../whiteboard/window';
import type { createDemoIntegration } from '../demo/integration';
import { diagnostic } from '../diagnostics';

interface Options {
  recording: RecordingController;
  launcher: RecorderLauncher;
  hud: RecordingHud;
  whiteboard: WhiteboardWindow;
  demo: ReturnType<typeof createDemoIntegration>;
  editor(): BrowserWindow | undefined;
  quitting(): boolean;
  changed(state: RecordingState): void;
  openProject(project: Project): Promise<void>;
}

/** Recording keeps its original launcher window; only the editor and camera have separate lifecycles. */
export function installRecordingPresentation(options: Options): void {
  const { recording, launcher, hud, whiteboard, demo } = options;
  let previousStatus = recording.state.status;
  recording.onState = state => {
    demo.status('record', state.status);
    const wasCapturing = ['starting', 'recording', 'stopping'].includes(previousStatus);
    previousStatus = state.status;
    launcher.publishRecordingState(state);
    hud.update(recording.controls.snapshot());
    whiteboard.update(state);
    options.changed(state);
    if (state.status === 'error' && wasCapturing && !options.quitting()) {
      options.editor()?.hide();
      void launcher.show().catch(error => diagnostic('recorder.restore', error));
    }
  };
  recording.prepareCapture = async (source, capture) => {
    demo.prepare('record', source.id);
    launcher.setExpanded(false);
    if (!demo.controller.state.enabled) options.editor()?.hide();
    hud.setCaptureBounds(source.bounds ? process.platform === 'win32' ? screen.screenToDipRect(null, source.bounds) : source.bounds : undefined);
    const boardHandle = await whiteboard.prepare(source, capture);
    if (process.platform !== 'win32' && demo.controller.state.enabled) return [];
    // The board has its own output mode even when the rest of the app is demonstrated.
    // Windows interface mode uses a separate board track; canvas mode replays only content.
    return [...(demo.controller.state.enabled ? [] : Object.values(hud.getWindowHandles())), boardHandle]
      .filter((value): value is string => Boolean(value));
  };
  recording.onProject = project => {
    void options.openProject(project).catch(async error => {
      diagnostic('editor.open-recording', error);
      if (options.quitting()) return;
      await launcher.show().catch(failure => diagnostic('recorder.restore', failure));
      dialog.showErrorBox('录制已保存，编辑器未能打开', error instanceof Error ? error.message : String(error));
    });
  };
}
