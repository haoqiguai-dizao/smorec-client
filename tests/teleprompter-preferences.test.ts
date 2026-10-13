import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTeleprompterPreferences, readTeleprompterPreferences, saveTeleprompterPreferences,
  TELEPROMPTER_PREFERENCES_KEY, TELEPROMPTER_TEXT_LIMIT } from '../src/services/teleprompter-preferences';

test('teleprompter preferences preserve a script and independent reading settings', () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  const preferences = { text: '今天先说第一点。\n停顿，再说第二点。', speed: 45, fontSize: 32 };
  saveTeleprompterPreferences(preferences, storage);
  assert.deepEqual([...entries.keys()], [TELEPROMPTER_PREFERENCES_KEY]);
  assert.deepEqual(readTeleprompterPreferences(storage), preferences);
});
test('teleprompter storage bounds text and finite numeric settings without coercing strings', () => {
  const value = normalizeTeleprompterPreferences({ text: '稿'.repeat(TELEPROMPTER_TEXT_LIMIT + 500), speed: 900, fontSize: 2, unknown: true });
  assert.equal(value.text.length, TELEPROMPTER_TEXT_LIMIT); assert.equal(value.speed, 100); assert.equal(value.fontSize, 18);
  assert.deepEqual(normalizeTeleprompterPreferences({ text: 55, speed: '60', fontSize: NaN }), { text: '', speed: 30, fontSize: 26 });
  assert.deepEqual(normalizeTeleprompterPreferences({ speed: Infinity, fontSize: -Infinity }), { text: '', speed: 30, fontSize: 26 });
  assert.deepEqual(normalizeTeleprompterPreferences([]), { text: '', speed: 30, fontSize: 26 });
});
test('unavailable, corrupt or full preference storage never prevents reading', () => {
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual(readTeleprompterPreferences(blocked), { text: '', speed: 30, fontSize: 26 });
  assert.deepEqual(readTeleprompterPreferences({ getItem: () => '{invalid', setItem: () => {} }), { text: '', speed: 30, fontSize: 26 });
  assert.doesNotThrow(() => saveTeleprompterPreferences({ text: '继续', speed: 30, fontSize: 26 }, blocked));
});
