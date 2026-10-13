import { app, BrowserWindow, globalShortcut, ipcMain, Menu, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { DemoController } from './controller';
import { hasBoardCapturePolicy, setBoardDemoVisibility } from '../whiteboard/capture-policy';
import type { RecordingController } from '../recording';
import type { LiveSession } from '../live/session';
import { diagnostic } from '../diagnostics';
import { shortcutLabel } from '../../../shared/shortcut-label';
import { bindCameraCapturePreparation, isIndependentCameraWindow } from './camera-policy';

interface Options {
  recording: RecordingController;
  live(): LiveSession;
  trusted(event: IpcMainInvokeEvent): boolean;
  editor(): Promise<void>;
  presentationHidden(hidden: boolean): void;
  changed(): void;
}
export function createDemoIntegration(options: Options) {
  const protectedWindows = new Map<BrowserWindow, boolean>();
  const hiddenWindows = new Set<BrowserWindow>();
  const windowGuards = new Map<BrowserWindow, () => void>();
  const shortcuts = new Set<string>();
  const filterWaiters = new Set<() => void>();
  let kind: 'record' | 'live' | undefined;
  let desktopHidden = false;
  const protect = (visible: boolean) => {
    setBoardDemoVisibility(visible, BrowserWindow.getAllWindows());
    if (process.platform !== 'win32') return;
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || hasBoardCapturePolicy(window) || isIndependentCameraWindow(window)) continue;
      if (!protectedWindows.has(window)) protectedWindows.set(window, window.isContentProtected());
      window.setContentProtection(!visible);
    }
  };
  const desktop = (hidden: boolean) => {
    desktopHidden = hidden;
    options.presentationHidden(hidden);
    if (hidden) {
      for (const window of BrowserWindow.getAllWindows()) if (window.isVisible()) { hiddenWindows.add(window); window.hide(); }
    } else {
      for (const window of hiddenWindows) if (!window.isDestroyed()) window.showInactive();
      hiddenWindows.clear();
    }
  };
  const watchWindow = (window: BrowserWindow) => {
    if (windowGuards.has(window)) return;
    const shown = () => {
      if (!desktopHidden || window.isDestroyed()) return;
      hiddenWindows.add(window);
      window.hide();
      // Electron can emit show before its native show call returns.
      setImmediate(() => { if (desktopHidden && !window.isDestroyed()) window.hide(); });
    };
    windowGuards.set(window, shown); window.on('show', shown); window.on('focus', shown);
    window.once('closed', () => { windowGuards.delete(window); hiddenWindows.delete(window); protectedWindows.delete(window); });
    if (window.isVisible()) shown();
  };
  const controller = new DemoController({
    apply: async visible => {
      if (kind === 'record') {
        protect(visible);
        try { await options.recording.setDemoVisibility(visible); }
        catch (error) { if (controller.state.active) protect(controller.state.visible); throw error; }
      } else if (kind === 'live') {
        protect(visible);
        try { await options.live().setDemoVisibility(visible); }
        catch (error) { if (controller.state.active) protect(controller.state.visible); throw error; }
      } else throw new Error('当前没有演示采集');
    },
    windows: desktop,
    restore: () => {
      setBoardDemoVisibility(false, BrowserWindow.getAllWindows());
      desktop(false);
      for (const [window, previous] of protectedWindows)
        if (!window.isDestroyed() && !hasBoardCapturePolicy(window) && !isIndependentCameraWindow(window)) window.setContentProtection(previous);
      protectedWindows.clear(); kind = undefined;
    },
    changed: state => {
      if (!state.busy || !state.active) { for (const resolve of filterWaiters) resolve(); filterWaiters.clear(); }
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send('demo:changed', state);
      options.changed();
    },
  });
  const unbindCameraPreparation = bindCameraCapturePreparation(async () => {
    while (controller.state.active && controller.state.busy) await new Promise<void>(resolve => filterWaiters.add(resolve));
    if (!controller.state.active || !controller.state.ready || !controller.state.visible) return;
    await controller.refresh();
  });
  const run = (action: () => void | Promise<void>) => {
    void Promise.resolve().then(action).catch(error => diagnostic('demo.action', error));
  };
  const items = (): MenuItemConstructorOptions[] => {
    const state = controller.state;
    return [
      { label: '演示模式', accelerator: 'CmdOrCtrl+Shift+D', type: 'checkbox', checked: state.enabled,
        enabled: !state.busy && (!state.active || state.ready) && !state.desktopHidden,
        click: () => run(() => controller.setEnabled(!state.enabled)) },
      { label: shortcutLabel(`${state.visible ? '从画面隐藏小录界面' : '让小录界面进入画面'}  Ctrl+Shift+D`, process.platform),
        enabled: state.enabled && state.ready && !state.busy && !state.desktopHidden, click: () => run(() => controller.toggle()) },
      { label: '显示编辑器', enabled: state.enabled && !state.desktopHidden && (!state.active || state.ready), click: () => run(options.editor) },
      { label: shortcutLabel(`${state.desktopHidden ? '恢复桌面上的小录窗口' : '收起桌面上的小录窗口'}  Ctrl+Alt+Shift+D`, process.platform),
        enabled: state.enabled && state.ready && !state.busy, click: () => run(() => controller.toggleDesktop()) },
      ...(state.error ? [{ label: state.error, enabled: false }] : []),
    ];
  };
  const created = (_event: Electron.Event, window: BrowserWindow) => {
    watchWindow(window);
    if (controller.state.active && process.platform === 'win32') {
      protectedWindows.set(window, window.isContentProtected()); window.setContentProtection(!controller.state.visible);
    }
  };
  return {
    controller, items,
    captureOptions: () => ({ captureOwnApp: controller.state.enabled, ownAppVisible: controller.state.enabled && controller.state.visible }),
    prepare(capture: 'record' | 'live', sourceId: string): void {
      controller.begin(sourceId); kind = capture;
      protect(controller.state.visible);
    },
    status(capture: 'record' | 'live', status: string): void {
      if (kind !== capture) return;
      if (status === 'recording' || status === 'live') controller.started();
      if (status === 'stopping') controller.stopping();
      if (status === 'idle' || status === 'error') controller.end();
    },
    install(): void {
      for (const window of BrowserWindow.getAllWindows()) watchWindow(window);
      app.on('browser-window-created', created);
      for (const [key, action] of [
        ['CommandOrControl+Shift+D', () => controller.setEnabled(!controller.state.enabled)],
        ['CommandOrControl+Alt+Shift+D', () => controller.toggleDesktop()],
      ] as const) {
        if (globalShortcut.register(key, () => run(action))) shortcuts.add(key);
        else { if (key === 'CommandOrControl+Shift+D') controller.shortcut(false); diagnostic('demo.shortcut-unavailable', key); }
      }
      for (const channel of ['demo:state', 'demo:menu']) ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (!options.trusted(event) || args.length) throw new Error('演示请求来源或参数无效');
        if (channel === 'demo:state') return { ...controller.state };
        Menu.buildFromTemplate(items()).popup({ window: BrowserWindow.fromWebContents(event.sender) ?? undefined });
      });
    },
    dispose(): void {
      unbindCameraPreparation();
      controller.end(); app.removeListener('browser-window-created', created);
      for (const [window, shown] of windowGuards) { window.removeListener('show', shown); window.removeListener('focus', shown); }
      windowGuards.clear();
      for (const key of shortcuts) globalShortcut.unregister(key);
      for (const channel of ['demo:state', 'demo:menu']) ipcMain.removeHandler(channel);
    },
  };
}
