import { app, BrowserWindow } from 'electron';

const levels = new Map<BrowserWindow, number>();
const suspended = new Map<BrowserWindow, number>();
let requests = 0;
let handingOff = false;
let returned = false;
let listening = false;

/** Preserve each overlay's own level without competing with macOS permission UI. */
export function setFloatingWindow(window: BrowserWindow, relativeLevel: number): void {
  if (!levels.has(window)) window.once('closed', () => { levels.delete(window); suspended.delete(window); });
  levels.set(window, relativeLevel);
  if (handingOff) {
    suspended.set(window, relativeLevel);
    window.setAlwaysOnTop(false);
  } else window.setAlwaysOnTop(true, 'floating', relativeLevel);
}

function restoreIfReturned(): void {
  // A native request can finish before its system alert. Do not restore merely
  // because the IPC resolved: the user must have returned to an owned window.
  if (!handingOff || !returned || requests || !BrowserWindow?.getFocusedWindow?.()) return;
  handingOff = false;
  for (const [window, level] of suspended) {
    if (!window.isDestroyed()) window.setAlwaysOnTop(true, 'floating', levels.get(window) ?? level);
  }
  suspended.clear();
}

/** Applies to explicit requests and the capture host's first screen-source probe. */
export async function withSystemPermissionFocus<T>(request: () => Promise<T>): Promise<T> {
  if (process.platform !== 'darwin') return request();
  if (!listening) {
    listening = true;
    const activate = () => { returned = true; restoreIfReturned(); };
    app.on('browser-window-focus', activate);
    app.on('did-become-active', activate);
    app.on('browser-window-blur', () => { returned = false; });
  }
  requests++;
  if (!handingOff) returned = false;
  handingOff = true;
  for (const window of BrowserWindow?.getAllWindows?.() ?? []) {
    if (!window.isDestroyed() && window.isAlwaysOnTop()) {
      suspended.set(window, levels.get(window) ?? 0);
      window.setAlwaysOnTop(false);
    }
  }
  try { return await request(); }
  finally { requests--; restoreIfReturned(); }
}
