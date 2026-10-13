import type { BrowserWindow } from 'electron';
import type { BoardPresentation } from '../../../shared/whiteboard/types';

const owned = new WeakMap<BrowserWindow, BoardPresentation>();
let demoVisible = false;
export const hasBoardCapturePolicy = (window: BrowserWindow): boolean => owned.has(window);

/** Normal canvas controls stay excluded; demo records their actual visible interface. */
export function applyBoardCapturePolicy(window: BrowserWindow, mode: BoardPresentation): void {
  owned.set(window, mode);
  if (process.platform === 'win32') window.setContentProtection(mode === 'canvas' && !demoVisible);
}

/** Demo owns actual window visibility; closing it restores the chosen output mode. */
export function setBoardDemoVisibility(visible: boolean, windows: BrowserWindow[]): void {
  demoVisible = visible;
  for (const window of windows) {
    const mode = owned.get(window);
    if (mode && !window.isDestroyed()) applyBoardCapturePolicy(window, mode);
  }
}
