import path from 'node:path';
import { writeSyntheticWave } from './microphone-audio';

export const nativeTrialEvents: { method: string; device?: string; directory?: string; at: number }[] = [];
let failNextStop = false;
export function injectNativeMicrophoneStopFailure(): void { failNextStop = true; }
export function clearNativeMicrophoneStopFailure(): void { failNextStop = false; }
/** Build-time replacement for NativeClient only inside this integration test. No device API is reachable. */
export class NativeClient {
  private directory = '';
  private started = 0;
  async request(method: string, parameters?: { directory: string; deviceId: string }) {
    nativeTrialEvents.push({ method, directory: parameters?.directory, device: parameters?.deviceId, at: Date.now() });
    if (method === 'microphone-trial-start') {
      this.directory = parameters!.directory; this.started = Date.now(); return {};
    }
    if (method === 'microphone-trial-stop') {
      if (failNextStop) { failNextStop = false; throw new Error('Explicit synthetic microphone stop failure'); }
      const duration = Math.max(.5, (Date.now() - this.started) / 1000), samples = Math.round(duration * 48000);
      await writeSyntheticWave(path.join(this.directory, 'microphone.wav'), 48000, 1, samples,
        frame => (.025 + .1 * (Math.floor(frame / 12000) % 2)) * Math.sin(frame * Math.PI * 2 * 220 / 48000));
      return { duration: samples / 48000 };
    }
    throw new Error('Unexpected native test command: ' + method);
  }
  async shutdownGracefully() { nativeTrialEvents.push({ method: 'shutdown', directory: this.directory, at: Date.now() }); }
}
