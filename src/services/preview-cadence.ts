/** Keep animated overlays at project FPS, including when the source holds its last frame. */
export class PreviewCadence {
  private lastFrame = -1;
  private lastFps = 0;

  reset(): void { this.lastFrame = -1; }

  take(sourceTime: number, fps: number): boolean {
    const frame = Math.floor(Math.max(0, sourceTime) * fps + 1e-6);
    if (frame === this.lastFrame && fps === this.lastFps) return false;
    this.lastFrame = frame; this.lastFps = fps;
    return true;
  }
}
