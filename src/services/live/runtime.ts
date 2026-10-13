import type { LiveAction, LiveApi, LiveConfiguration } from '../../../shared/live-types';
import { LiveComposition } from './composition';
import { LivePreview } from './preview';
import { LiveCamera } from './camera';
import type { LiveRuntimeIssue } from '../../../shared/live-issues';

interface DisplayOptions {
  preview?(canvas: HTMLCanvasElement): void;
  progress?(audioLevel: number): void;
  visible?(): boolean;
  failed?(error: unknown): void;
  notice?(issue: LiveRuntimeIssue): void;
}

export class LiveRuntime {
  private composition: LiveComposition;
  private camera: LiveCamera;
  private stopped = false;
  private running?: Promise<void>;
  private failureStage: LiveRuntimeIssue = 'renderer-pull';
  private display?: LivePreview;
  private displayVisible = true;
  constructor(private api: LiveApi, private config: LiveConfiguration, private stream: () => MediaStream | null,
    private failed: (error: unknown, issue: LiveRuntimeIssue) => void, private displayOptions: DisplayOptions = {}) {
    this.composition = new LiveComposition(config);
    if (config.inputRecording === false) this.composition.zoom.toggle();
    this.camera = new LiveCamera(issue => displayOptions.notice?.(issue));
    if (displayOptions.preview) this.display = new LivePreview(config.width, config.height);
  }
  start(): void {
    this.running = this.loop().catch(error => { if (!this.stopped) this.failed(error, this.failureStage); })
      .finally(() => {
        this.camera.dispose();
        this.display?.dispose(); this.composition.dispose();
      });
  }
  setPreviewEnabled(enabled: boolean): void { this.display?.setEnabled(enabled); }
  setPreviewVisible(visible: boolean): void { this.displayVisible = visible; }
  action(action: LiveAction): void {
    if (action === 'reset-zoom') this.composition.zoom.reset();
    if (action === 'toggle-auto-zoom' && this.config.inputRecording !== false) this.composition.zoom.toggle();
  }
  private async loop(): Promise<void> {
    while (!this.stopped) {
      const start = performance.now();
      this.failureStage = 'renderer-pull';
      const frame = await this.api.pull(this.config.id);
      if (this.stopped) return;
      this.failureStage = 'renderer-compose';
      const output = this.composition.render(frame, this.camera.current(this.stream(), performance.now()));
      this.failureStage = 'renderer-push';
      await this.api.push(this.config.id, output);
      this.failureStage = 'renderer-progress';
      this.displayOptions.progress?.(frame.audioLevel ?? 0);
      // A display failure must never stop the encoder or its audio clock.
      try {
        this.display?.setVisible(this.displayVisible && (this.displayOptions.visible?.() ?? true));
        if (this.display?.present(this.composition.canvas, performance.now())) this.displayOptions.preview?.(this.display.canvas);
      } catch (error) { this.display?.setEnabled(false); this.displayOptions.failed?.(error); }
      const remaining = 1000 / this.config.fps - (performance.now() - start);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    }
  }
  async stop(): Promise<void> { this.stopped = true; await this.running; }
}
