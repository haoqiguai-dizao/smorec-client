type Schedule = (callback: () => void, delay: number) => () => void;

/** Interaction state stays separate from the renderer and native window geometry. */
export class ToolbarAutoCollapse {
  private collapsed = false;
  private enabled = false;
  private keepExpanded = false;
  private hovered = false;
  private keyboardFocused = false;
  private delay = 700;
  private cancel?: () => void;
  private listeners = new Set<() => void>();
  constructor(private schedule: Schedule = (callback, delay) => {
    const timer = setTimeout(callback, delay); return () => clearTimeout(timer);
  }) {}
  snapshot = (): boolean => this.collapsed;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  configure(enabled: boolean, keepExpanded = false, delay = 700): void {
    this.enabled = enabled; this.keepExpanded = keepExpanded; this.delay = delay; this.refresh();
  }
  pointer(inside: boolean): void { this.hovered = inside; this.refresh(); }
  focus(keyboardFocused: boolean): void { this.keyboardFocused = keyboardFocused; this.refresh(); }
  expand = (): void => { this.set(false); this.refresh(); };
  collapse = (): void => { if (this.enabled) { this.cancel?.(); this.cancel = undefined; this.set(true); } };
  dispose(): void { this.cancel?.(); this.cancel = undefined; }
  private set(value: boolean): void {
    if (value === this.collapsed) return;
    this.collapsed = value; this.listeners.forEach(listener => listener());
  }
  private refresh(): void {
    this.cancel?.(); this.cancel = undefined;
    if (!this.enabled || this.keepExpanded) { this.set(false); return; }
    if (this.collapsed) return;
    if (this.hovered || this.keyboardFocused) return;
    this.cancel = this.schedule(() => { this.cancel = undefined; this.set(true); }, this.delay);
  }
}
