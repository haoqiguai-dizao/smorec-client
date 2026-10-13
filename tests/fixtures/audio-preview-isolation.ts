import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { microphonePreset } from '../../shared/microphone-effects';
import { MicrophoneEffectsCache } from '../../electron/services/microphone-effects/cache';
import { ProjectAudioMixCache } from '../../electron/services/project-audio/cache';
import { runMicrophoneProcess } from '../../electron/services/microphone-effects/process';
import { readSyntheticWave, writeSyntheticWave } from './microphone-audio';

/** Separate synthetic channels expose any accidental effect applied to system sound. */
export async function verifyAudioPreviewIsolation(directory: string) {
  await fs.mkdir(directory, { recursive: true });
  const rate = 48000, samples = rate * 4, signal = new AbortController().signal;
  const system = path.join(directory, 'system.wav'), microphone = path.join(directory, 'microphone.wav');
  await writeSyntheticWave(system, rate, 2, samples, (frame, channel) => channel ? 0 : .04 * Math.sin(frame * Math.PI * 2 * 880 / rate));
  await writeSyntheticWave(microphone, rate, 2, samples, (frame, channel) => channel ?
    (.018 + .012 * Math.sin(frame / rate * Math.PI)) * Math.sin(frame * Math.PI * 2 * 180 / rate) + .004 * Math.sin(frame * Math.PI * 2 * 4000 / rate) : 0);
  const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const originalHashes = await Promise.all([hash(system), hash(microphone)]);
  const effects = new MicrophoneEffectsCache({ directory: path.join(directory, 'effects-cache'), executable: () => ffmpeg! });
  const mix = new ProjectAudioMixCache({ directory: path.join(directory, 'mix-cache'), executable: () => ffmpeg! });
  const results: { preset: string; systemMaxError: number; microphoneRmsDifference: number }[] = [];
  const source = await readSyntheticWave(system), raw = await readSyntheticWave(microphone);
  const copyWave = async (file: string, destination: string) => {
    await runMicrophoneProcess(ffmpeg!, ['-threads', '1', '-y', '-i', file, '-c:a', 'pcm_f32le', destination], signal);
  };
  try {
    for (const preset of ['original', 'natural', 'clear', 'warm'] as const) {
      const processed = await effects.resolve(microphone, microphonePreset(preset));
      const output = await mix.resolve([{ path: system, volume: 1 }, { path: processed, volume: 1 }], 4);
      const decoded = await readSyntheticWave(output);
      let error = 0, changed = 0;
      for (let frame = 0; frame < samples; frame++) {
        error = Math.max(error, Math.abs(decoded.channels[0][frame] - source.channels[0][frame]));
        changed += (decoded.channels[1][frame] - raw.channels[1][frame]) ** 2;
      }
      assert.ok(error < 1e-6, `${preset} must not apply microphone effects to system PCM (error ${error})`);
      const difference = Math.sqrt(changed / samples);
      if (preset !== 'original') assert.ok(difference > .001, `${preset} must actually change microphone PCM`);
      results.push({ preset, systemMaxError: error, microphoneRmsDifference: difference });
      await copyWave(processed, path.join(directory, `microphone-${preset}.wav`));
      await copyWave(output, path.join(directory, `mix-${preset}.wav`));
    }
    const solo = await mix.resolve([{ path: system, volume: 1 }, { path: microphone, volume: 0 }], 4);
    await copyWave(solo, path.join(directory, 'mix-system-only.wav'));
    assert.deepEqual(await Promise.all([hash(system), hash(microphone)]), originalHashes);
    const report = { result: 'PASS', syntheticOnly: true, rate, samples, results, sourcesUnchanged: true };
    await fs.writeFile(path.join(directory, 'pcm-report.json'), JSON.stringify(report, null, 2));
    return report;
  } finally { effects.dispose(); mix.dispose(); }
}
