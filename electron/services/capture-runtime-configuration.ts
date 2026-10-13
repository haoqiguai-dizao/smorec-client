import type { App } from 'electron';

/** Platform flags belong to capture startup, before any camera or renderer exists. */
export function configureCaptureRuntime(app: App, platform = process.platform): void {
  if (platform !== 'win32') return;
  // Prefer the discrete GPU for dual-4K composition; retain normal device fallback.
  if (!app.commandLine.hasSwitch('force_low_power_gpu')) app.commandLine.appendSwitch('force_high_performance_gpu');
  // Chromium's D3D11 camera path can crash VideoCaptureService with 0xC0000005.
  const disabled = new Set(app.commandLine.getSwitchValue('disable-features').split(',').map(value => value.trim()).filter(Boolean));
  disabled.add('MediaFoundationD3D11VideoCapture');
  app.commandLine.appendSwitch('disable-features', [...disabled].join(','));
}
