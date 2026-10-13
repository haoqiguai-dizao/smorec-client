import type { DemoState } from '../../../shared/demo';

interface Options {
  apply(visible: boolean): Promise<void>;
  windows(hidden: boolean): void;
  restore(): void;
  changed(state: DemoState): void;
}
/** One authority for button, shortcut and tray; never stop or restart a capture. */
export class DemoController {
  state: DemoState = { enabled: false, visible: false, active: false, ready: false,
    busy: false, desktopHidden: false, shortcutAvailable: true };
  private generation = 0;
  private desktopWasVisible = false;
  constructor(private options: Options) {}
  private publish(patch: Partial<DemoState>): void {
    this.state = { ...this.state, ...patch }; this.options.changed({ ...this.state });
  }
  configure(enabled: boolean): void {
    if (this.state.active || this.state.busy) throw new Error('请在采集开始前设置演示模式');
    this.publish({ enabled, visible: enabled, error: undefined });
  }
  begin(sourceId: string): void {
    if (this.state.enabled && !sourceId.startsWith('screen:')) throw new Error('演示全部界面请使用屏幕或区域采集');
    this.generation++;
    this.publish({ active: true, ready: false, error: undefined });
  }
  started(): void { if (this.state.active) this.publish({ ready: true }); }
  stopping(): void { if (this.state.active) this.publish({ ready: false }); }
  end(): void {
    if (!this.state.active) return;
    this.generation++;
    this.options.restore();
    this.publish({ enabled: false, visible: false, active: false, ready: false, busy: false, desktopHidden: false, error: undefined });
  }
  shortcut(available: boolean): void { this.publish({ shortcutAvailable: available }); }
  async refresh(): Promise<void> {
    if (!this.state.active || !this.state.ready || this.state.busy) throw new Error('正在准备或切换演示画面，请稍候');
    const generation = this.generation;
    this.publish({ busy: true, error: undefined });
    try { await this.options.apply(this.state.visible); }
    catch (error) {
      if (generation === this.generation) this.publish({ error: error instanceof Error ? error.message : '演示画面更新失败' });
      throw error;
    } finally { if (generation === this.generation) this.publish({ busy: false }); }
  }
  async setEnabled(enabled: boolean): Promise<void> {
    if (!this.state.active) { this.configure(enabled); return; }
    if (!this.state.ready || this.state.busy) throw new Error('正在准备或切换演示画面，请稍候');
    if (this.state.desktopHidden) throw new Error('请先恢复桌面上的小录窗口');
    if (this.state.enabled === enabled) return;
    const generation = this.generation;
    this.publish({ busy: true, error: undefined });
    try {
      await this.options.apply(enabled);
      if (generation === this.generation) this.publish({ enabled, visible: enabled });
    } catch (error) {
      if (generation === this.generation) this.publish({ error: error instanceof Error ? error.message : '演示画面切换失败' });
      throw error;
    } finally { if (generation === this.generation) this.publish({ busy: false }); }
  }
  async toggle(): Promise<void> {
    if (!this.state.active) { this.configure(!this.state.enabled); return; }
    if (!this.state.enabled) { await this.setEnabled(true); return; }
    if (this.state.desktopHidden) throw new Error('请先恢复桌面上的小录窗口');
    if (!this.state.ready || this.state.busy) throw new Error('正在准备或切换演示画面，请稍候');
    const generation = this.generation, visible = !this.state.visible;
    this.publish({ busy: true, error: undefined });
    try {
      await this.options.apply(visible);
      if (generation === this.generation) this.publish({ visible });
    } catch (error) {
      if (generation === this.generation) this.publish({ error: error instanceof Error ? error.message : '演示画面切换失败' });
      throw error;
    } finally { if (generation === this.generation) this.publish({ busy: false }); }
  }
  async toggleDesktop(): Promise<void> {
    if (!this.state.enabled || !this.state.ready || this.state.busy) return;
    const hidden = !this.state.desktopHidden;
    const generation = this.generation;
    if (hidden) {
      this.desktopWasVisible = this.state.visible;
      if (this.state.visible) await this.toggle();
      if (generation !== this.generation) return;
      this.options.windows(true); this.publish({ desktopHidden: true });
    } else {
      this.options.windows(false); this.publish({ desktopHidden: false });
      if (this.desktopWasVisible && !this.state.visible) await this.toggle();
    }
  }
}
