import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { MicrophoneSession } from '../../electron/services/microphone-session';
import { nativeTrialEvents } from './microphone-native-session';

/** Hold directory preparation across suspend, before a NativeClient can be assigned. */
export async function verifyMicrophonePreparationRace(microphones: MicrophoneSession) {
  let enter!: () => void, release!: () => void, created = '';
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = fs.mkdtemp;
  const nativeStartCount = () => nativeTrialEvents.filter(event => event.method === 'microphone-trial-start').length;
  const before = nativeStartCount();
  fs.mkdtemp = (async (...parameters: Parameters<typeof fs.mkdtemp>) => {
    if (!String(parameters[0]).includes('smorec-microphone-')) return original(...parameters);
    enter(); await gate;
    const directory = await original(...parameters); created = String(directory); return directory;
  }) as typeof fs.mkdtemp;
  try {
    const pending = microphones.startTrial('synthetic-preparation-race').then(
      result => ({ result, error: '' }), error => ({ result: undefined, error: String(error) }));
    await Promise.race([entered, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Directory preparation was not reached')), 3000))]);
    await microphones.suspend();
    const startsWhenSuspended = nativeStartCount();
    release();
    const outcome = await pending;
    assert.ok(outcome.error.includes('取消'), 'Late preparation must reject as canceled');
    assert.equal(startsWhenSuspended, before);
    assert.equal(nativeStartCount(), before, 'Native acquisition must never start after suspend returned');
    assert.ok(created);
    assert.equal(await fs.stat(created).then(() => true, () => false), false, 'Canceled empty trial directory must be removed');
    return { canceledBeforeNativeStart: true, directoryRemoved: true, error: outcome.error };
  } finally { release(); fs.mkdtemp = original; await microphones.suspend(); }
}
