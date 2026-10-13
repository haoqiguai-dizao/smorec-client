import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyAudioPreviewIsolation } from './fixtures/audio-preview-isolation';

test('real microphone presets leave the independent system PCM unchanged in the shared preview/export mix', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smorec-audio-isolation-'));
  try { await verifyAudioPreviewIsolation(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
});
