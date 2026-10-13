import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { AUDIO_MIX_PEAK } from '../shared/audio-mix';
import { ProjectAudioMixCache } from '../electron/services/project-audio/cache';
import { runMicrophoneProcess } from '../electron/services/microphone-effects/process';
import { readWaveInfo } from '../electron/services/microphone-effects/wave';
import { exportAudioFilters } from '../electron/services/export-audio';
import { floatWavePeak, peakIndex, readSyntheticWave, rms, writeSyntheticWave } from './fixtures/microphone-audio';

const root = path.resolve('output/project-audio-tests'); await fs.mkdir(root, { recursive: true });
const directory = await fs.mkdtemp(path.join(root, 'run-')), rate = 48000;
const cache = new ProjectAudioMixCache({ directory: path.join(directory, 'cache'), executable: () => ffmpeg! });
const evidence: unknown[] = [];
const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
test.after(async () => { cache.dispose(); await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ evidence }, null, 2)); });
async function wave(name: string, channels: number, duration: number, signal: (frame: number, channel: number) => number, sampleRate = rate) {
  const file = path.join(directory, `${name}.wav`);
  await writeSyntheticWave(file, sampleRate, channels, Math.round(duration * sampleRate), signal); return file;
}
async function cut(source: string, volume = 1, clips = [{ id: 'a', start: 0, end: 2 }]) {
  const destination = path.join(directory, `cut-${Math.random().toString(36).slice(2)}.wav`);
  const duration = clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
  await runMicrophoneProcess(ffmpeg!, ['-threads', '1', '-y', '-f', 'lavfi', '-i', 'color=s=16x16:r=1:d=1',
    '-i', source, '-filter_complex_threads', '1', '-filter_complex', exportAudioFilters([volume], clips, duration, (await readWaveInfo(source)).channels),
    '-map', '[outa]', '-c:a', 'pcm_f32le', destination], new AbortController().signal);
  return readSyntheticWave(destination);
}

test('silent stereo system track preserves mono microphone level and single-track export amplitude', async () => {
  const system = await wave('silent', 2, 2, () => 0), microphone = await wave('mono', 1, 2, frame => .12 * Math.sin(frame * .03));
  const originalHash = await hash(microphone), inputs = [{ path: system, volume: 1 }, { path: microphone, volume: 1 }];
  const output = await cache.resolve(inputs, 2), mixed = await readSyntheticWave(output), raw = await readSyntheticWave(microphone);
  const singleExport = await cut(microphone), dualExport = await cut(output);
  for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < rate * 2; frame++) {
    assert.ok(Math.abs(mixed.channels[channel][frame] - raw.channels[0][frame]) < 1e-6);
    assert.ok(Math.abs(singleExport.channels[channel][frame] - raw.channels[0][frame]) < 1e-6);
    assert.ok(Math.abs(dualExport.channels[channel][frame] - raw.channels[0][frame]) < 1e-6);
  }
  assert.equal(await hash(microphone), originalHash);
  assert.equal(await cache.resolve(inputs, 2), output);
  evidence.push({ test: 'silent-system-mono-microphone', measuredGainDb: 20 * Math.log10(rms(mixed.channels[0], 0, rate * 2) / rms(raw.channels[0], 0, rate * 2)), originalUnchanged: true });
});

test('actual simultaneous peaks are limited without shifting impulses or losing the last sample', async () => {
  const samples = rate + 137, points = [0, 12345, samples - 1];
  const input = await wave('peaks', 2, samples / rate, frame => points.includes(frame) ? .9 : 0);
  const output = await cache.resolve([{ path: input, volume: 1 }, { path: input, volume: 1 }], samples / rate);
  const audio = await readSyntheticWave(output), peak = await floatWavePeak(output, await readWaveInfo(output));
  assert.equal(audio.channels[0].length, samples); assert.ok(peak <= AUDIO_MIX_PEAK + 1e-6);
  for (const point of points) {
    assert.equal(peakIndex(audio.channels[0], Math.max(0, point - 40), Math.min(samples, point + 40)), point);
    assert.ok(audio.channels[0][point] > .8);
  }
  evidence.push({ test: 'peak-protection-alignment', samples, peak, delaySamples: 0 });
});

test('quiet mixes retain their sum and a shorter or muted track does not boost the remaining signal', async () => {
  const system = await wave('short', 2, .75, frame => .1 * Math.sin(frame * .04));
  const microphone = await wave('long', 2, 2, frame => .1 * Math.sin(frame * .03));
  const input = await readSyntheticWave(microphone), shorter = await readSyntheticWave(system);
  const mixed = await readSyntheticWave(await cache.resolve([{ path: system, volume: .5 }, { path: microphone, volume: .8 }], 2));
  const muted = await readSyntheticWave(await cache.resolve([{ path: system, volume: 0 }, { path: microphone, volume: .8 }], 2));
  const silent = await readSyntheticWave(await cache.resolve([{ path: system, volume: 0 }, { path: microphone, volume: 0 }], 2));
  for (let frame = 0; frame < rate * 2; frame++) {
    const expected = input.channels[0][frame] * .8 + (shorter.channels[0][frame] ?? 0) * .5;
    assert.ok(Math.abs(mixed.channels[0][frame] - expected) < 1e-6);
    assert.ok(Math.abs(muted.channels[0][frame] - input.channels[0][frame] * .8) < 1e-6);
    assert.equal(silent.channels[0][frame], 0);
  }
});

test('export cuts the exact protected preview cache, including limiter release across clip boundaries', async () => {
  const input = await wave('cuts', 2, 2, (frame, channel) => (frame < 30000 ? .9 : .12) * Math.sin(frame * (channel ? .07 : .03)));
  const output = await cache.resolve([{ path: input, volume: 1 }, { path: input, volume: 1 }], 2);
  const preview = await readSyntheticWave(output), clips = [{ id: 'a', start: .125, end: .675 }, { id: 'b', start: 1.3, end: 1.8 }];
  const exported = await cut(output, 1, clips);
  for (let channel = 0; channel < 2; channel++) {
    const expected = clips.flatMap(clip => Array.from(preview.channels[channel].slice(Math.round(clip.start * rate), Math.round(clip.end * rate))));
    assert.equal(exported.channels[channel].length, expected.length);
    for (let frame = 0; frame < expected.length; frame++) assert.ok(Math.abs(exported.channels[channel][frame] - expected[frame]) < 1e-6);
  }
  evidence.push({ test: 'same-preview-export-cuts', frames: exported.channels[0].length, maximumError: 1e-6 });
});

test('cache cancellation, changed levels and corruption cannot publish stale or partial output', async () => {
  const input = await wave('cancel', 1, 4, frame => .1 * Math.sin(frame * .03)), inputs = [{ path: input, volume: 1 }, { path: input, volume: .5 }];
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(cache.resolve(inputs, 4, aborted.signal), { name: 'AbortError' });
  const active = new AbortController(), canceled = cache.resolve(inputs, 4, active.signal); active.abort();
  await assert.rejects(canceled, { name: 'AbortError' });
  const output = await cache.resolve(inputs, 4), previous = await hash(output);
  const quieter = await cache.resolve([inputs[0], { ...inputs[1], volume: 0 }], 4); assert.notEqual(quieter, output);
  await fs.writeFile(output, 'corrupt'); assert.equal(await cache.resolve(inputs, 4), output); assert.equal(await hash(output), previous);
  assert.equal((await fs.readdir(path.join(directory, 'cache'))).some(file => file.includes('.part.')), false);
});

test('a running shared mix survives one canceled reader; cancelAll releases workers and allows retry', async () => {
  const input = await wave('shared', 2, 40, frame => .1 * Math.sin(frame * .03));
  const jobDirectory = path.join(directory, 'shared-cache');
  const worker = new ProjectAudioMixCache({ directory: jobDirectory, executable: () => ffmpeg! });
  const inputs = [{ path: input, volume: 1 }, { path: input, volume: .5 }];
  const waitForPart = async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if ((await fs.readdir(jobDirectory).catch(() => [])).some(file => file.endsWith('.part.wav'))) return;
      await new Promise(resolve => setTimeout(resolve, 3));
    }
    assert.fail('The test must observe an actual running FFmpeg mix');
  };
  try {
    const controller = new AbortController(), first = worker.resolve(inputs, 40, controller.signal);
    const rejected = assert.rejects(first, { name: 'AbortError' }), survivor = worker.resolve(inputs, 40);
    await waitForPart(); controller.abort(); await rejected;
    assert.equal((await readWaveInfo(await survivor)).samples, rate * 40);
    const changed = [{ ...inputs[0], volume: .75 }, inputs[1]], interrupted = worker.resolve(changed, 40);
    const canceled = assert.rejects(interrupted, { name: 'AbortError' });
    await waitForPart(); worker.cancelAll(); await canceled;
    assert.equal((await readWaveInfo(await worker.resolve(changed, 40))).samples, rate * 40);
    assert.equal((await fs.readdir(jobDirectory)).some(file => file.includes('.part.')), false);
    evidence.push({ test: 'shared-job-cancel', observedRunningWorker: true, remainingConsumerCompletes: true, cancelAllAllowsRetry: true });
  } finally { worker.dispose(); }
});

test('the protected full-scale sine mix remains unclipped after the production AAC encoding settings', async () => {
  const input = await wave('aac', 2, 2, frame => Math.sin(frame * Math.PI * 2 * 1000 / rate));
  const mixed = await cache.resolve([{ path: input, volume: 1 }, { path: input, volume: 1 }], 2);
  const encoded = path.join(directory, 'protected.m4a'), decoded = path.join(directory, 'decoded.wav'), signal = new AbortController().signal;
  await runMicrophoneProcess(ffmpeg!, ['-threads', '1', '-y', '-i', mixed, '-c:a', 'aac', '-b:a', '192k', encoded], signal);
  await runMicrophoneProcess(ffmpeg!, ['-threads', '1', '-y', '-i', encoded, '-c:a', 'pcm_f32le', decoded], signal);
  const info = await readWaveInfo(decoded), peak = await floatWavePeak(decoded, info);
  assert.ok(peak < 1); assert.ok(Math.abs(info.samples - rate * 2) <= 1024);
  evidence.push({ test: 'full-scale-sine-aac', decodedPeak: peak, decodedPeakDb: 20 * Math.log10(peak), paddedSamples: info.samples - rate * 2 });
});
