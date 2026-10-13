import { BrowserWindow, Menu } from 'electron';
import type { BoardPresentation, BoardWindowOptions } from '../../../shared/whiteboard/types';
import type { NativeClient } from '../native-client';
import { captureWindowHandle } from '../platform/capture-runtime';

/** Main owns the window identity. Renderers cannot choose a capture target or output path. */
export class WhiteboardPresentation {
  mode: BoardPresentation = 'canvas';
  busy = false;
  readonly supported: boolean;
  private included = false;
  private registered?: string | number;
  private pending = Promise.resolve();
  constructor(private native?: NativeClient, private live?: (windowId: string | number, visible: boolean) => Promise<boolean>) {
    this.supported = ['darwin', 'win32'].includes(process.platform) && !!native;
  }
  reset(): void { this.mode = 'canvas'; this.included = false; this.registered = undefined; this.pending = Promise.resolve(); this.busy = false; }
  sync(window: BrowserWindow, mode: BoardPresentation, visible: boolean): Promise<void> {
    const include = mode === 'interface' && visible;
    const apply = async () => {
    if (!this.supported) throw new Error('完整界面录制模块不可用');
    // getNativeWindowHandle is an NSView pointer on Mac, not a CGWindowID.
    const id = process.platform === 'win32' ? captureWindowHandle(window.getNativeWindowHandle(), 'win32')
      : /^window:(\d+):/.exec(window.getMediaSourceId())?.[1];
    if (!id) throw new Error('无法确认白板采集窗口');
    const windowId = process.platform === 'win32' ? id : Number(id);
    if (this.included === include && this.registered === windowId) return;
    if (!await this.live?.(windowId, include)) {
      await this.native!.request('whiteboard-presentation', { windowId, visible: include });
    }
    this.included = include;
    this.registered = windowId;
    };
    const result = this.pending.then(apply);
    this.pending = result.catch(() => {});
    return result;
  }
  choose(window: BrowserWindow, controls?: { options: BoardWindowOptions; transparencySupported?: boolean;
    change: (value: Partial<BoardWindowOptions>) => void }): Promise<BoardPresentation | undefined> {
    return new Promise(resolve => {
      let selected: BoardPresentation | undefined;
      const menu = Menu.buildFromTemplate([
        { label: '完整界面', type: 'radio', checked: this.mode === 'interface', enabled: this.supported,
          click: () => { selected = 'interface'; } },
        { label: '纯画布', type: 'radio', checked: this.mode === 'canvas', click: () => { selected = 'canvas'; } },
        ...(controls ? [
          { type: 'separator' as const },
          { label: '白板置顶', type: 'checkbox' as const, checked: controls.options.pinned,
            click: () => controls.change({ pinned: !controls.options.pinned }) },
          { label: '透明画布', type: 'checkbox' as const, checked: controls.options.transparent,
            enabled: controls.transparencySupported !== false,
            click: () => controls.change({ transparent: !controls.options.transparent }) },
          { label: controls.options.passthrough ? '返回白板书写' : '操作下层应用', accelerator: 'CmdOrCtrl+Shift+B',
            click: () => controls.change({ passthrough: !controls.options.passthrough }) },
        ] : []),
      ]);
      menu.popup({ window, callback: () => resolve(selected) });
    });
  }
}
