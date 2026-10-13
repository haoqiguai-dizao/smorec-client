import type { RecordingControlAction } from '../../../shared/types';
import type { LiveRecordingControls } from '../live-recording-controls';

interface Options {
  ready(): boolean;
  controls: Pick<LiveRecordingControls, 'snapshot' | 'control'>;
  show(): void;
  openSettings(): void;
  effectsChanged: (effects: NonNullable<ReturnType<LiveRecordingControls['snapshot']>['cameraEffects']>) => void;
}

/** Live camera edits affect composition while the existing capture device stays connected. */
export class LiveCameraControls {
  constructor(private options: Options) {}
  async control(action: RecordingControlAction): Promise<void> {
    if (!this.options.ready()) throw new Error('请等待投屏准备完成');
    if (!action.type.startsWith('camera-')) throw new Error('投屏期间只能调整摄像头画面');
    await this.options.controls.control(action);
    if (action.type === 'camera-effects') {
      const effects = this.options.controls.snapshot().cameraEffects;
      if (effects) this.options.effectsChanged(effects);
    }
  }
  async open(): Promise<void> {
    if (!this.options.ready()) throw new Error('请等待投屏准备完成');
    const camera = this.options.controls.snapshot();
    if (!camera.cameraAvailable) throw new Error('请在开始投屏前开启摄像头');
    if (!camera.cameraVisible) await this.control({ type: 'camera-visible', value: true });
    this.options.show();
    this.options.openSettings();
  }
  async restore(): Promise<void> {
    const camera = this.options.controls.snapshot();
    if (camera.cameraAvailable && camera.cameraPreviewing && !camera.cameraVisible) {
      await this.options.controls.control({ type: 'camera-visible', value: true });
    }
  }
}
