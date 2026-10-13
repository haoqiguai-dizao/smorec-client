import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import type { WhiteboardWindow } from '../../electron/services/whiteboard/window';
import type { BoardEvent, BoardMode, BoardPresentation, BoardSnapshot } from '../../shared/whiteboard/types';

export async function fixture(toolbarUrl?: string, idle = false) {
  const windows: FakeWindow[] = [], diagnostics: unknown[][] = [];
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  class FakeWindow extends EventEmitter {
    shown = false;
    crashed = false;
    loaded = 0;
    bounds = area;
    pinned = false;
    passthrough = false;
    background = '';
    opacity = 1;
    protected = false;
    beforeLoad = async () => {};
    autoReady = true;
    lastState?: BoardSnapshot;
    reveals: BoardSnapshot[] = [];
    webContents = Object.assign(new EventEmitter(), {
      send: (channel: string, state?: BoardSnapshot) => {
        if (channel === 'whiteboard:state') this.lastState = state;
        if (this.autoReady && channel === 'whiteboard:state' && state?.opening) queueMicrotask(() => {
          handlers.get('whiteboard:view-ready')?.({ sender: this.webContents, senderFrame: this.webContents.mainFrame }, state.session, state.opening);
        });
      }, setWindowOpenHandler() {}, isCrashed: () => this.crashed,
      mainFrame: { url: 'frameflow://app/index.html?overlay=whiteboard' },
    });
    constructor() { super(); windows.push(this); }
    isDestroyed() { return false; }
    isVisible() { return this.shown; }
    setAlwaysOnTop(value: boolean) { this.pinned = value; }
    setIgnoreMouseEvents(value: boolean) { this.passthrough = value; }
    setBackgroundColor(value: string) { this.background = value; }
    setHasShadow() {}
    setResizable() {}
    setOpacity(value: number) { this.opacity = value; }
    setContentProtection(value: boolean) { this.protected = value; }
    setVisibleOnAllWorkspaces() {}
    setBounds(value: typeof area) { this.bounds = value; }
    getBounds() { return this.bounds; }
    getNativeWindowHandle() { return Buffer.alloc(8); }
    async loadURL() { this.loaded++; await this.beforeLoad(); this.crashed = false; }
    show() { this.shown = true; if (this.lastState) this.reveals.push(structuredClone(this.lastState)); }
    hide() { this.shown = false; }
    destroy() {}
  }
  const injected = { BrowserWindow: FakeWindow, diagnostics, area, handlers, selectedMode: undefined as number | undefined };
  const bundled = await build({ entryPoints: ['electron/services/whiteboard/window.ts'], bundle: true,
    write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'whiteboard-window-fixture', setup(builder) {
      builder.onResolve({ filter: /^(electron|\.\/speech-session|\.\.\/diagnostics)$/ },
        args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
        path === 'electron' ? `export const BrowserWindow=injected.BrowserWindow;
          export const app={getAppPath:()=>'/tmp',getPath:()=>'/tmp/whiteboard-fixture'};
          export const screen={screenToDipRect:(_window,rect)=>rect, getCursorScreenPoint:()=>({x:0,y:0}),
            getDisplayNearestPoint:()=>({workArea:injected.area}), getDisplayMatching:()=>({workArea:injected.area})};
          export const ipcMain={handle(channel,callback){injected.handlers.set(channel,callback)},removeHandler(){}};
          export const globalShortcut={register(){return true},unregister(){}};
          export const clipboard={},nativeImage={},Menu={buildFromTemplate(items){return {popup({callback}){
            const item=items[injected.selectedMode]; if(item?.enabled) item.click(); callback(); }}}};`
          : path === './speech-session' ? 'export class SpeechSession {}'
            : 'export const diagnostic=(...args)=>injected.diagnostics.push(args);' }));
    } }] });
  const module = { exports: {} as { WhiteboardWindow: typeof WhiteboardWindow } };
  new Function('require', 'module', 'exports', 'injected', bundled.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, injected);
  const covered: boolean[] = [];
  const events: BoardEvent['action'][] = [];
  const previews: string[] = [], resets: string[] = [];
  const journal = { session: 'first', events: [],
    startPreview: async (directory: string) => { previews.push(directory); journal.session = 'draft'; },
    newBoard: async () => { resets.push(journal.session); },
    seedLayout: (action: BoardEvent['action']) => { events.push(action); },
    append: async (action: BoardEvent['action']) => { events.push(action); } };
  const speech = { setDevice() {}, shutdown: async () => {}, ready: async () => {} };
  let include = async () => {};
  let selected: BoardPresentation | undefined;
  const syncs: { mode: BoardPresentation; visible: boolean }[] = [];
  const presentation = { mode: 'canvas', supported: true, busy: false,
    reset() { this.mode = 'canvas'; }, choose: async () => selected,
    sync: async (_window: unknown, mode: BoardPresentation, visible: boolean) => {
      syncs.push({ mode, visible }); await include();
    } };
  const toolbar = toolbarUrl ? { isDestroyed: () => false,
    webContents: { mainFrame: { url: toolbarUrl }, send() {} } } : undefined;
  const board = new module.exports.WhiteboardWindow(journal as never, () => toolbar as never,
    () => false, speech as never, presentation as never, { request() {}, signal() {}, covered(value) { covered.push(value); } });
  const prepare = async (kind: 'screen' | 'window' = 'screen') => {
    await board.prepare({ id: 'screen:1', kind, name: 'test', width: 1920, height: 1080, bounds: area },
      { sourceId: 'screen:1', fps: 30, microphone: false, systemAudio: false });
    board.update({ status: 'recording' });
  };
  if (!idle) await prepare();
  const request = (name: string, ...args: unknown[]) => handlers.get(`whiteboard:${name}`)!({
    sender: windows[0].webContents, senderFrame: windows[0].webContents.mainFrame }, ...args);
  return { board, journal, events, covered, windows, presentation, diagnostics, prepare, toolbar, syncs, previews, resets,
    invoke: (event: unknown) => handlers.get('whiteboard:snapshot')!(event),
    request,
    toolbarRequest: (name: string, ...args: unknown[]) => handlers.get(`whiteboard:${name}`)!({
      sender: toolbar!.webContents, senderFrame: toolbar!.webContents.mainFrame }, ...args),
    selectMode: (mode?: BoardMode) => {
      injected.selectedMode = mode ? ['canvas', 'interface', 'camera'].indexOf(mode) : undefined;
      const sender = toolbar?.webContents ?? windows[0].webContents;
      return handlers.get('whiteboard:mode')!({ sender, senderFrame: sender.mainFrame });
    },
    choose: (mode: BoardPresentation) => {
      selected = mode;
      return handlers.get('whiteboard:presentation')!({ sender: toolbar!.webContents, senderFrame: toolbar!.webContents.mainFrame });
    },
    include: (value: () => Promise<void>) => { include = value; } };
}

