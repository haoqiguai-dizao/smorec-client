import type { ExportProgress } from './export-video';

/** Progress ticks notify the modal only; the editor observes export start/end. */
export class ExportProgressStore {
  private value: ExportProgress = { progress: 0, phase: '准备导出' };
  private listeners = new Set<() => void>();
  getSnapshot = (): ExportProgress => this.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  update = (value: ExportProgress): void => {
    this.value = value;
    for (const listener of this.listeners) listener();
  };
}
