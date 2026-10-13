/** Test-only transport: synthetic media through the complete production main/IPC/UI flow. */
import { screen } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NativeClient } from './services/native-client';
import { ffmpegPath } from './services/ffmpeg';
import type { NativeRecordingResult } from '../shared/types';

export function installSyntheticCapture() {
  const display = screen.getPrimaryDisplay();
  const source = { id: 'screen:fixture', kind: 'screen', name: '受控媒体', width: display.bounds.width * 2,
    height: display.bounds.height * 2, bounds: display.bounds };
  let directory = '', startedAt = 0, running = false;
  const audio = { microphoneMuted: false, systemAudioMuted: false };
  NativeClient.prototype.available = () => true;
  NativeClient.prototype.isRunning = () => running;
  NativeClient.prototype.shutdownGracefully = async () => { running = false; };
  NativeClient.prototype.dispose = () => { running = false; };
  NativeClient.prototype.request = async function<T>(command: string, extra: Record<string, unknown> = {}): Promise<T> {
    let value: unknown;
    if (command === 'capabilities') value = { screenPermission: true, inputPermission: true, accessibilityPermission: true };
    else if (command === 'sources') value = [source];
    else if (command === 'live-applications' || command === 'microphone-devices') value = [];
    else if (command === 'start') {
      directory = String(extra.directory); startedAt = Date.now(); running = true;
      await promisify(execFile)(ffmpegPath(), ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
        'color=c=0x194339:size=1200x800:rate=30:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p', path.join(directory, 'screen.mp4')]);
      await fs.writeFile(path.join(directory, 'cursor.json'), '[]');
      value = { startedAtUnixMs: startedAt };
    } else if (command === 'stop') {
      running = false;
      value = { directory, duration: 4, width: 1200, height: 800, video: 'screen.mp4', cursor: 'cursor.json',
        startedAtUnixMs: startedAt } satisfies NativeRecordingResult;
    } else if (command === 'recording-demo') value = { time: (Date.now() - startedAt) / 1000 };
    else if (command === 'audio-mute') { Object.assign(audio, extra.options); value = { ...audio }; }
    else throw Error('Unexpected synthetic transport command: ' + command);
    return value as T;
  };
}
