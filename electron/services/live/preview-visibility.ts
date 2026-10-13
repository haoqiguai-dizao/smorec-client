import type { BrowserWindow } from 'electron';

/** backgroundThrottling=false keeps capture running but makes document.hidden insufficient. */
export function watchPreviewVisibility(window: Pick<BrowserWindow, 'isDestroyed' | 'isVisible' | 'isMinimized' | 'on' | 'removeListener'>,
  changed: (visible: boolean) => void) {
  const publish = () => changed(!window.isDestroyed() && window.isVisible() && !window.isMinimized());
  const dispose = () => {
    window.removeListener('show', publish);
    window.removeListener('hide', publish);
    window.removeListener('minimize', publish);
    window.removeListener('restore', publish);
    window.removeListener('closed', dispose);
  };
  window.on('show', publish);
  window.on('hide', publish);
  window.on('minimize', publish);
  window.on('restore', publish);
  window.on('closed', dispose);
  return { publish, dispose };
}
