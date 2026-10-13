import electron, { type BrowserWindow, type Rectangle } from 'electron';
import { pointInsideRegions } from '../../../shared/input-regions';

interface RegionState { regions: Rectangle[]; dragging: boolean; ignored: boolean; refresh(): void }
const tracked = new Map<BrowserWindow, RegionState>();
let timer: ReturnType<typeof setInterval> | undefined;

function refresh() {
  for (const [window, state] of tracked) {
    if (window.isDestroyed()) { tracked.delete(window); continue; }
    if (window.isVisible()) state.refresh();
  }
  if (!tracked.size) { clearInterval(timer); timer = undefined; }
}

/** Keep mouse passthrough separate from painting on Windows and macOS.
 * A native shape survives window resizing: a bottom-aligned region from the
 * expanded window can clip the entire collapsed toolbar before remeasurement.
 * Content protection must not depend on those experimental drawing regions.
 */
export function setWindowInputRegions(window: BrowserWindow | undefined, regions: Rectangle[], options: { inputOnly?: boolean } = {}): void {
  if (!window || window.isDestroyed()) return;
  if (process.platform !== 'darwin' && !(process.platform === 'win32' && options.inputOnly)) { window.setShape(regions); return; }
  let state = tracked.get(window);
  if (!state) {
    const entry: RegionState = { regions, dragging: false, ignored: false, refresh: () => {
      if (window.isDestroyed()) return;
      // Accessed only inside Electron; pure toolbar validation also runs in Node tests.
      const point = electron.screen.getCursorScreenPoint(), bounds = window.getContentBounds();
      const ignored = !entry.dragging && !pointInsideRegions(point.x - bounds.x, point.y - bounds.y, entry.regions);
      if (entry.ignored !== ignored) { window.setIgnoreMouseEvents(ignored, { forward: true }); entry.ignored = ignored; }
    } };
    state = entry; tracked.set(window, entry);
    const mouse = (_event: Electron.Event, input: Electron.MouseInputEvent) => {
      if (input.type === 'mouseDown') entry.dragging = true;
      if (input.type === 'mouseUp') entry.dragging = false;
      entry.refresh();
    };
    window.webContents.on('before-mouse-event', mouse);
    window.on('blur', () => { entry.dragging = false; entry.refresh(); });
    window.on('show', entry.refresh);
    window.on('move', entry.refresh);
    window.once('closed', () => { tracked.delete(window); refresh(); });
  }
  state.regions = regions.map(rect => ({ ...rect }));
  state.refresh();
  if (!timer) { timer = setInterval(refresh, 16); timer.unref(); }
}
