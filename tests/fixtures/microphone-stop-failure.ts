import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { MicrophoneSession } from '../../electron/services/microphone-session';
import { clearNativeMicrophoneStopFailure, injectNativeMicrophoneStopFailure, nativeTrialEvents } from './microphone-native-session';

export async function verifyMicrophoneStopFailure(microphones: MicrophoneSession) {
  try {
    const trial = await microphones.startTrial('synthetic-stop-failure');
    const started = nativeTrialEvents.findLast(event => event.method === 'microphone-trial-start')!;
    injectNativeMicrophoneStopFailure();
    await assert.rejects(microphones.finishTrial(trial.id), /Explicit synthetic microphone stop failure/);
    assert.ok(nativeTrialEvents.some(event => event.method === 'shutdown' && event.directory === started.directory),
      'Failed finish must shut down its native client before returning the error');
    assert.equal(await fs.stat(started.directory!).then(() => true, () => false), false,
      'Failed finish must remove the trial directory');
    const retry = await microphones.startTrial('synthetic-stop-retry');
    const retryStarted = nativeTrialEvents.findLast(event => event.method === 'microphone-trial-start')!;
    const sample = await microphones.finishTrial(retry.id);
    assert.equal(sample.id, retry.id); assert.ok(sample.duration > 0);
    assert.ok(sample.url.startsWith('frameflow://audio/'));
    await microphones.cancelTrial(retry.id);
    assert.ok(nativeTrialEvents.some(event => event.method === 'shutdown' && event.directory === retryStarted.directory));
    assert.equal(await fs.stat(retryStarted.directory!).then(() => true, () => false), false);
    return { errorReleasedNative: true, failedDirectoryRemoved: true, successfulRetry: true,
      retryDuration: sample.duration, retryCleanedUp: true };
  } finally { clearNativeMicrophoneStopFailure(); await microphones.suspend(); }
}
