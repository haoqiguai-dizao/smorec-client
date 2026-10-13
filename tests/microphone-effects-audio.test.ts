import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { microphonePreset } from '../shared/microphone-effects';
import { MicrophoneEffectsCache } from '../electron/services/microphone-effects/cache';
import { dbGain } from '../electron/services/microphone-effects/filters';
import { readWaveInfo } from '../electron/services/microphone-effects/wave';
import { runMicrophoneProcess } from '../electron/services/microphone-effects/process';
import { exportAudioFilters } from '../electron/services/export-audio';
import { floatWavePeak, peakIndex, readSyntheticWave, rms, writeSyntheticWave } from './fixtures/microphone-audio';

const root = path.resolve('output', 'microphone-effects-tests');
await fs.mkdir(root, { recursive: true });
const directory = await fs.mkdtemp(path.join(root, 'run-'));
const cache = new MicrophoneEffectsCache({ directory: path.join(directory, 'cache'), executable: () => ffmpeg! });
const evidence: unknown[] = [];
const isolated = () => ({ ...microphonePreset('original'), enabled: true });
const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
test.after(async () => { cache.dispose(); await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ evidence }, null, 2)); });

test('FFT noise reduction compensates delay at 16/44.1/48/96 kHz and preserves stereo and tail samples', async () => {
  for (const rate of [16000, 44100, 48000, 96000]) {
    const frames = rate + 137, impulses = [Math.floor(rate * .2), frames - 7];
    const source = path.join(directory, `impulses-${rate}.wav`);
    await writeSyntheticWave(source, rate, 2, frames, (frame, channel) => impulses.includes(frame - channel * 2) ? .7 : 0);
    const originalHash = await hash(source), effects = isolated(); effects.noiseReduction = 'light';
    const output = await cache.resolve(source, effects), audio = await readSyntheticWave(output);
    assert.equal(audio.rate, rate);
    assert.equal(audio.channels.length, 2);
    for (let channel = 0; channel < 2; channel++) {
      assert.equal(audio.channels[channel].length, frames);
      for (const impulse of impulses) {
        const expected = impulse + channel * 2;
        const actual = peakIndex(audio.channels[channel], Math.max(0, expected - 64), Math.min(frames, expected + 64));
        assert.equal(actual, expected, `${rate} Hz channel ${channel}: no FFT delay may shift an impulse`);
        assert.ok(audio.channels[channel][actual] > .3, 'A strong final transient must not be discarded as padding');
      }
    }
    assert.equal(await hash(source), originalHash);
    assert.equal(await cache.resolve(source, undefined), source, 'Legacy/original playback is the original file');
    assert.equal(await cache.resolve(source, effects), output, 'Identical source and parameters reuse a validated cache');
    evidence.push({ test: 'noise-delay', rate, channels: 2, frames, delaySamples: 0, rawUnchanged: true });
  }
});

test('limiter compensates lookahead at both ends and obeys the selected ceiling without auto makeup', async () => {
  const rate = 48000, frames = rate + 59, source = path.join(directory, 'limiter.wav');
  await writeSyntheticWave(source, rate, 1, frames, frame => [0, 20000, frames - 1].includes(frame) ? .98 : 0);
  const effects = isolated(); effects.limiter = { enabled: true, ceilingDb: -6 };
  const output = await cache.resolve(source, effects), audio = (await readSyntheticWave(output)).channels[0];
  assert.equal(audio.length, frames);
  for (const expected of [0, 20000, frames - 1]) assert.ok(Math.abs(audio[expected]) > .3, 'No leading/final sample may be lost');
  assert.ok(Math.max(...audio) <= dbGain(-6) + 1e-6);
  evidence.push({ test: 'limiter', frames, ceilingDb: -6, peak: Math.max(...audio) });
});

test('automatic volume lifts quiet speech with bounded gain and leaves pause noise at its original level', async () => {
  const rate = 48000, source = path.join(directory, 'automatic-level.wav'), frames = rate * 10;
  let seed = 593711;
  await writeSyntheticWave(source, rate, 1, frames, frame => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = seed / 0x80000000 * .0004, seconds = frame / rate;
    const amplitude = seconds < 1 || seconds >= 4 && seconds < 5 || seconds >= 8 ? 0 : seconds < 4 ? .015 : seconds < 7 ? .18 : .95;
    return amplitude * Math.sin(frame * 2 * Math.PI * 180 / rate) + noise;
  });
  const raw = (await readSyntheticWave(source)).channels[0], effects = isolated();
  effects.autoLevel = { enabled: true, maxGainDb: 12 }; effects.limiter = { enabled: true, ceilingDb: -1 };
  const output = await cache.resolve(source, effects), audio = (await readSyntheticWave(output)).channels[0];
  const gain = (from: number, to: number) => rms(audio, from * rate, to * rate) / rms(raw, from * rate, to * rate);
  const quietGain = gain(2.5, 3.2), normalGain = gain(6, 6.8), noiseGain = gain(9, 10), quietPauseGain = gain(4.25, 4.85);
  assert.ok(quietGain > 3 && quietGain <= dbGain(12) + .01, `Quiet speech needs real controlled gain (${quietGain})`);
  assert.ok(noiseGain <= 1.05, `Pauses must not retain speech amplification (${noiseGain})`);
  assert.ok(quietPauseGain <= 1.15, `A pause after boosted quiet speech must not be boosted (${quietPauseGain})`);
  assert.ok(normalGain > .6 && normalGain < 1.6);
  assert.ok(await floatWavePeak(output, await readWaveInfo(output)) <= dbGain(-1) + 1e-6);
  assert.equal(audio.length, frames);
  const limited = isolated(); limited.autoLevel = { enabled: true, maxGainDb: 3 };
  const limitedAudio = (await readSyntheticWave(await cache.resolve(source, limited))).channels[0];
  const limitedGain = rms(limitedAudio, rate * 2.5, Math.round(rate * 3.2)) / rms(raw, rate * 2.5, Math.round(rate * 3.2));
  assert.ok(limitedGain <= dbGain(3) + .01 && limitedGain > 1.2, 'Maximum gain is an effective constraint');
  const natural = (await readSyntheticWave(await cache.resolve(source, microphonePreset('natural')))).channels[0];
  const naturalQuietGain = rms(natural, rate * 2.5, Math.round(rate * 3.2)) / rms(raw, rate * 2.5, Math.round(rate * 3.2));
  assert.ok(naturalQuietGain > 2, `The shipped natural preset must audibly lift quiet speech (${naturalQuietGain})`);
  evidence.push({ test: 'automatic-volume', quietGainDb: 20 * Math.log10(quietGain), normalGainDb: 20 * Math.log10(normalGain),
    pauseNoiseGainDb: 20 * Math.log10(noiseGain), quietPauseGainDb: 20 * Math.log10(quietPauseGain),
    naturalQuietGainDb: 20 * Math.log10(naturalQuietGain), maximumGainDb: 12, frames });
});

test('automatic volume and the full natural preset retain source alignment and non-silent final samples at every supported test rate', async () => {
  for (const rate of [16000, 44100, 48000, 96000]) {
    const source = path.join(directory, `automatic-impulses-${rate}.wav`), frames = rate + 139;
    const points = [0, Math.floor(rate * .6), frames - 1];
    await writeSyntheticWave(source, rate, 1, frames, frame => points.includes(frame) ? .8 : 0);
    for (const effects of [microphonePreset('natural'), { ...isolated(), autoLevel: { enabled: true, maxGainDb: 18 } }]) {
      const audio = (await readSyntheticWave(await cache.resolve(source, effects))).channels[0];
      assert.equal(audio.length, frames);
      for (const point of points) {
        const actual = peakIndex(audio, Math.max(0, point - 48), Math.min(frames, point + 48));
        assert.equal(actual, point, `Automatic volume may not shift ${rate} Hz impulse at ${point}`);
        assert.ok(Math.abs(audio[actual]) > .02, 'Both file boundaries retain actual signal after their selected dynamics');
      }
    }
  }
});

test('low cut and EQ change their intended bands, while compression and expansion affect different levels', async () => {
  const rate = 48000, frames = rate * 2, source = path.join(directory, 'tones.wav');
  await writeSyntheticWave(source, rate, 2, frames, (frame, channel) => .1 * Math.sin(frame * 2 * Math.PI * (channel ? 3000 : 35) / rate));
  const baseline = await readSyntheticWave(source), lowcut = isolated(); lowcut.highpass = { enabled: true, frequencyHz: 100 };
  const filtered = await readSyntheticWave(await cache.resolve(source, lowcut));
  const lowRatio = rms(filtered.channels[0], rate, frames) / rms(baseline.channels[0], rate, frames);
  const highRatio = rms(filtered.channels[1], rate, frames) / rms(baseline.channels[1], rate, frames);
  assert.ok(lowRatio < .15 && highRatio > .98);
  const eq = isolated(); eq.eq = { enabled: true, lowDb: 0, presenceDb: 6, airDb: 0 };
  const shaped = await readSyntheticWave(await cache.resolve(source, eq));
  assert.ok(rms(shaped.channels[1], rate, frames) / rms(baseline.channels[1], rate, frames) > 1.95);

  const dynamics = path.join(directory, 'dynamics.wav');
  await writeSyntheticWave(dynamics, rate, 1, frames, frame => (frame < rate ? .004 : .65) * Math.sin(frame * 2 * Math.PI * 700 / rate));
  const raw = (await readSyntheticWave(dynamics)).channels[0], compression = isolated(); compression.compression = .8;
  const compressed = (await readSyntheticWave(await cache.resolve(dynamics, compression))).channels[0];
  const ratio = (samples: Float32Array) => rms(samples, rate + 12000, frames) / rms(samples, 12000, rate);
  assert.ok(ratio(compressed) < ratio(raw) * .45, 'Compression narrows strong/quiet speech differences');
  const expansion = isolated(); expansion.expander = { enabled: true, thresholdDb: -35, ratio: 2 };
  const expanded = (await readSyntheticWave(await cache.resolve(dynamics, expansion))).channels[0];
  assert.ok(rms(expanded, 12000, rate) < rms(raw, 12000, rate) * .5, 'Expansion lowers quiet noise');
  assert.ok(rms(expanded, rate + 12000, frames) > rms(raw, rate + 12000, frames) * .98, 'Expansion leaves speech above threshold intact');
  evidence.push({ test: 'bands-dynamics', lowRatio, highRatio, originalDynamicRatio: ratio(raw), compressedDynamicRatio: ratio(compressed) });
});

test('de-essing and noise reduction measurably reduce a sibilant burst and steady noise', async () => {
  const rate = 48000, frames = rate * 2, source = path.join(directory, 'sibilance.wav');
  let random = 123456789;
  await writeSyntheticWave(source, rate, 1, frames, frame => {
    random = (Math.imul(random, 1664525) + 1013904223) | 0;
    return (random / 0x80000000) * .002 + (frame > rate && frame < rate * 1.8 ? .35 * Math.sin(frame * 2 * Math.PI * 8000 / rate) : 0);
  });
  const raw = (await readSyntheticWave(source)).channels[0], deesser = isolated(); deesser.deEss = .8;
  const softened = (await readSyntheticWave(await cache.resolve(source, deesser))).channels[0];
  assert.ok(rms(softened, rate + 3000, rate + 30000) < rms(raw, rate + 3000, rate + 30000) * .9);
  const denoise = isolated(); denoise.noiseReduction = 'moderate';
  const cleaned = (await readSyntheticWave(await cache.resolve(source, denoise))).channels[0];
  const noiseRatio = rms(cleaned, rate / 2, rate - 1000) / rms(raw, rate / 2, rate - 1000);
  assert.ok(noiseRatio < .85, `Noise should be attenuated (${noiseRatio})`);
  evidence.push({ test: 'sibilance-noise', noiseRatio });
});

test('all presets process safely and overloaded EQ uses documented static attenuation with immutable raw input', async () => {
  const rate = 48000, source = path.join(directory, 'preset.wav');
  await writeSyntheticWave(source, rate, 1, rate, frame => .9 * Math.sin(frame * 2 * Math.PI * 3000 / rate));
  const originalHash = await hash(source);
  for (const name of ['natural', 'clear', 'warm'] as const) {
    const output = await cache.resolve(source, microphonePreset(name)), info = await readWaveInfo(output);
    assert.ok(await floatWavePeak(output, info) <= dbGain(-1) + 1e-5);
    assert.equal(info.samples, rate);
  }
  const effects = isolated(); effects.eq = { enabled: true, lowDb: 0, presenceDb: 6, airDb: 0 };
  const output = await cache.resolve(source, effects), info = await readWaveInfo(output);
  const metadata = JSON.parse(await fs.readFile(`${output}.json`, 'utf8'));
  assert.ok(metadata.safetyGain < .6 && metadata.safetyGain > 0);
  assert.ok(await floatWavePeak(output, info) <= dbGain(-1) + 1e-6);
  assert.equal(await hash(source), originalHash);
});

test('cancel, invalid media, corrupt cache and changing parameters cannot publish stale or partial audio', async () => {
  const source = path.join(directory, 'cancel.wav');
  await writeSyntheticWave(source, 48000, 1, 48000 * 4, frame => .1 * Math.sin(frame * .03));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(cache.resolve(source, microphonePreset('natural'), aborted.signal), { name: 'AbortError' });
  const cancel = new AbortController();
  const interrupted = cache.resolve(source, microphonePreset('clear'), cancel.signal);
  cancel.abort();
  await assert.rejects(interrupted, { name: 'AbortError' });
  const [natural, warm] = await Promise.all([cache.resolve(source, microphonePreset('natural')), cache.resolve(source, microphonePreset('warm'))]);
  assert.notEqual(natural, warm);
  const expected = await hash(natural);
  await fs.writeFile(natural, 'broken cache');
  assert.equal(await cache.resolve(source, microphonePreset('natural')), natural);
  assert.equal(await hash(natural), expected, 'Invalid cache must be regenerated, not returned');
  const invalid = path.join(directory, 'invalid.wav'); await fs.writeFile(invalid, 'not audio');
  await assert.rejects(cache.resolve(invalid, microphonePreset('natural')), /WAV/);
  assert.equal((await fs.readdir(path.join(directory, 'cache'))).some(file => file.includes('.part.')), false);
});

test('export cuts the same processed PCM used for preview at exact source positions without reprocessing effects', async () => {
  const rate = 48000, source = path.join(directory, 'export-source.wav');
  await writeSyntheticWave(source, rate, 2, rate * 2, (frame, channel) => .2 * Math.sin(frame * 2 * Math.PI * (channel ? 1100 : 350) / rate));
  const processed = await cache.resolve(source, microphonePreset('natural'));
  const preview = await readSyntheticWave(processed), exported = path.join(directory, 'export-mix.wav');
  const clips = [{ id: 'a', start: .25, end: .6 }, { id: 'b', start: 1.3, end: 1.6 }];
  await runMicrophoneProcess(ffmpeg!, ['-threads', '1', '-filter_threads', '1', '-y', '-f', 'lavfi', '-i', 'color=s=16x16:r=1:d=1',
    '-i', processed, '-filter_complex_threads', '1', '-filter_complex', exportAudioFilters([1], clips, .65),
    '-map', '[outa]', '-c:a', 'pcm_f32le', exported], new AbortController().signal);
  const result = await readSyntheticWave(exported);
  for (let channel = 0; channel < 2; channel++) {
    const expected = new Float32Array(clips.flatMap(clip => Array.from(preview.channels[channel].slice(Math.round(clip.start * rate), Math.round(clip.end * rate)))));
    assert.equal(result.channels[channel].length, expected.length);
    for (let frame = 0; frame < expected.length; frame++) assert.ok(Math.abs(result.channels[channel][frame] - expected[frame]) < 1e-6);
  }
  evidence.push({ test: 'preview-export-source-cuts', channels: 2, frames: 31200, maxError: 1e-6 });
});

test('an in-flight shared processing job survives one canceled consumer and stops when capture cancels all jobs', async () => {
  const source = path.join(directory, 'shared-job.wav'), jobDirectory = path.join(directory, 'shared-cache');
  await writeSyntheticWave(source, 48000, 1, 48000 * 40, frame => .2 * Math.sin(frame * .07));
  const worker = new MicrophoneEffectsCache({ directory: jobDirectory, executable: () => ffmpeg! });
  const waitForPart = async () => {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      if ((await fs.readdir(jobDirectory).catch(() => [])).some(file => file.endsWith('.part.wav'))) return;
      await new Promise(resolve => setTimeout(resolve, 3));
    }
    assert.fail('The test must cancel a genuinely running FFmpeg process');
  };
  try {
    const controller = new AbortController(), first = worker.resolve(source, microphonePreset('natural'), controller.signal);
    const rejected = assert.rejects(first, { name: 'AbortError' });
    const survivor = worker.resolve(source, microphonePreset('natural'));
    await waitForPart(); controller.abort(); await rejected;
    assert.equal((await readWaveInfo(await survivor)).samples, 48000 * 40);
    const interrupted = worker.resolve(source, microphonePreset('clear'));
    const cancellation = assert.rejects(interrupted, { name: 'AbortError' });
    await waitForPart(); worker.cancelAll(); await cancellation;
    // A subsequent request can start a fresh job; canceled jobs do not poison the service.
    const restored = await worker.resolve(source, microphonePreset('clear'));
    assert.equal((await readWaveInfo(restored)).samples, 48000 * 40);
    assert.equal((await fs.readdir(jobDirectory)).some(file => file.includes('.part.')), false);
    evidence.push({ test: 'shared-job-cancellation', oneConsumerContinues: true, cancelAllAllowsRetry: true });
  } finally { worker.dispose(); }
});
