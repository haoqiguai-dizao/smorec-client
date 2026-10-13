import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CaptureSource } from '../../../shared/types';
import type { LiveOptions, LiveBoardFrame } from '../../../shared/live-types';
import type { WhiteboardJournal } from '../whiteboard/journal';
import type { WhiteboardWindow } from '../whiteboard/window';

/** Live board assets have a bounded temporary lifecycle, independent of recorded projects. */
export class LiveWhiteboard {
  private directory?: string;
  private sent = 0;
  private session = '';
  constructor(private journal: WhiteboardJournal, private window: WhiteboardWindow) {}
  async prepare(source: CaptureSource, options: LiveOptions): Promise<string | undefined> {
    this.window.preparing('live');
    this.directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'xiaolu-live-board-'));
    this.sent = 0;
    await this.journal.reset(this.directory, true);
    this.session = this.journal.session;
    return this.window.prepare(source, { sourceId: source.id, crop: options.crop, fps: 30,
      systemAudio: !!options.systemAudio, microphone: false, microphoneDeviceId: options.microphoneDeviceId }, 'live');
  }
  async started(timestamp: number): Promise<void> {
    this.journal.start(timestamp);
    await this.journal.flush();
    this.window.update({ status: 'recording' }, 'live');
  }
  pull(): LiveBoardFrame | undefined {
    if (!this.directory) return;
    const from = this.sent;
    // Chunk large gestures; a missed renderer index is a protocol error, never silent data loss.
    const events = this.journal.events.slice(from, from + 256);
    this.sent += events.length;
    return { session: this.session, from, events };
  }
  async restore(): Promise<void> {
    this.window.update({ status: 'idle' }, 'live');
    const directory = this.directory; this.directory = undefined;
    this.session = '';
    try { await this.journal.flush(); }
    finally { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
  }
}
