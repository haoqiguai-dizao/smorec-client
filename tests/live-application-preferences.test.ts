import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationSelected, defaultLiveApplicationSelection, LIVE_APPLICATION_SELECTION_KEY, liveApplicationChoices,
  parseLiveApplications, readLiveApplicationSelection, saveLiveApplicationSelection, updateLiveApplicationSelection } from '../src/services/live-application-preferences';

const douyin = { id: 'D:\\Apps\\直播伴侣.exe', name: '抖音直播伴侣', executable: '直播伴侣.exe' };
const xhs = { id: 'D:\\Apps\\xhs-live-helper.exe', name: '小红书直播助手', executable: 'xhs-live-helper.exe' };
const browser = { id: 'C:\\Browser\\chrome.exe', name: 'Chrome', executable: 'chrome.exe' };
const wechat = { id: 'C:\\Chat\\WeChat.exe', name: '微信', executable: 'WeChat.exe' };
function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('first run defaults match only exact executable basenames without persisting a choice', () => {
  const storage = memoryStorage();
  assert.equal(readLiveApplicationSelection(storage), undefined);
  const impostor = { ...browser, name: '抖音直播伴侣' };
  assert.deepEqual(defaultLiveApplicationSelection([douyin, xhs, impostor, wechat]), [douyin, xhs]);
  assert.deepEqual(defaultLiveApplicationSelection([{ ...xhs, executable: 'XHS-LIVE-HELPER.EXE' }]), [{ ...xhs, executable: 'XHS-LIVE-HELPER.EXE' }]);
  assert.equal(storage.values.size, 0);
});

test('an explicitly empty selection survives restart without restoring defaults', () => {
  const storage = memoryStorage();
  saveLiveApplicationSelection([], storage);
  assert.deepEqual(readLiveApplicationSelection(storage), []);
  assert.notEqual(readLiveApplicationSelection(storage), undefined);
  assert.equal(storage.getItem(LIVE_APPLICATION_SELECTION_KEY), '[]');
});

test('adding and removing one application preserves independent selections and closed applications', () => {
  let selection = updateLiveApplicationSelection([douyin, xhs], browser, true);
  selection = updateLiveApplicationSelection(selection, wechat, true);
  selection = updateLiveApplicationSelection(selection, xhs, false);
  assert.deepEqual(selection, [douyin, browser, wechat]);
  const choices = liveApplicationChoices([browser], selection);
  assert.deepEqual(choices.map(({ id, running }) => ({ id, running })), [
    { id: browser.id, running: true }, { id: douyin.id, running: false }, { id: wechat.id, running: false },
  ]);
  selection = updateLiveApplicationSelection(selection, douyin, false);
  assert.deepEqual(selection, [browser, wechat]);
  assert.equal(liveApplicationChoices([browser], selection).some(app => app.id === douyin.id), false);
  assert.equal(liveApplicationChoices([browser, wechat], selection).find(app => app.id === wechat.id)?.running, true);
});

test('case and separator changes do not duplicate a selected Windows executable', () => {
  const movedCase = { ...browser, id: 'c:/BROWSER/CHROME.EXE', executable: 'CHROME.EXE' };
  assert.equal(applicationSelected([browser], movedCase.id), true);
  assert.deepEqual(updateLiveApplicationSelection([browser], movedCase, false), []);
  assert.equal(parseLiveApplications([browser, movedCase]).length, 1);
  assert.equal(liveApplicationChoices([movedCase], [browser]).length, 1);
});

test('storage retains only application identity and display metadata, never runtime details', () => {
  const storage = memoryStorage();
  saveLiveApplicationSelection([{ ...browser, pid: 123, windowTitle: 'PRIVATE WINDOW CONTENT', running: true } as typeof browser], storage);
  assert.deepEqual(readLiveApplicationSelection(storage), [browser]);
  const stored = storage.getItem(LIVE_APPLICATION_SELECTION_KEY)!;
  assert.deepEqual(Object.keys(JSON.parse(stored)[0]), ['id', 'name', 'executable']);
  assert.equal(stored.includes('PRIVATE'), false);
  assert.equal(stored.includes('pid'), false);
});

test('malformed selections and unavailable storage report failure instead of silently adding defaults', () => {
  const storage = memoryStorage();
  for (const value of ['{', 'null', '{}', '[42]', JSON.stringify([{ ...browser, id: 'chrome.exe' }]),
    JSON.stringify([{ ...browser, executable: 'another.exe' }]), JSON.stringify([{ ...browser, name: 'invalid\nname' }])]) {
    storage.setItem(LIVE_APPLICATION_SELECTION_KEY, value);
    assert.throws(() => readLiveApplicationSelection(storage));
    assert.equal(storage.getItem(LIVE_APPLICATION_SELECTION_KEY), value);
  }
  const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  assert.throws(() => readLiveApplicationSelection(denied), /denied/);
  assert.throws(() => saveLiveApplicationSelection([browser], denied), /full/);
});

test('the native 32-application limit rejects an addition without mutating the existing list', () => {
  const selection = Array.from({ length: 32 }, (_, i) => ({ id: `C:\\Apps\\app${i}.exe`, name: `Application ${i}`, executable: `app${i}.exe` }));
  const before = structuredClone(selection);
  assert.throws(() => updateLiveApplicationSelection(selection, browser, true), /32/);
  assert.deepEqual(selection, before);
  assert.throws(() => parseLiveApplications([{ ...browser, id: '\\\\server\\share\\chrome.exe' }]));
  const storage = memoryStorage();
  saveLiveApplicationSelection(selection, storage);
  assert.equal(readLiveApplicationSelection(storage)?.length, 32);
});
