import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WhiteboardJournal, readRecordedBoard } from '../electron/services/whiteboard/journal';
import { draftContent } from '../electron/services/whiteboard/draft';
import { applyBoardEvent, emptyBoard, boardAt } from '../shared/whiteboard/model';
import { parseBoardRecording } from '../shared/whiteboard/validation';
import type { BoardEvent } from '../shared/whiteboard/types';

const text = { kind: 'text' as const, id: 'title', text: '录前准备', color: '#202020', size: 20, x: 10, y: 20 };
const layout = { kind: 'layout' as const, visible: true, presentation: 'canvas' as const,
  bounds: { x: .1, y: .1, width: .7, height: .7 } };

async function directories() {
  const root = await fs.mkdtemp(path.resolve('output/whiteboard-draft-test-'));
  const draft = path.join(root, 'draft'), capture = path.join(root, 'capture');
  await fs.mkdir(capture);
  return { root, draft, capture };
}

test('preparation persists separately and becomes frame-zero content only after native accepts an empty capture directory', async () => {
  const d = await directories();
  try {
    const journal = new WhiteboardJournal();
    await journal.startPreview(d.draft); const draftSession = journal.session;
    await journal.append(text, 8_000_000); await journal.append(layout); await journal.flush();
    const before = await fs.readFile(path.join(d.draft, 'whiteboard.jsonl'));
    await journal.reset(d.capture); journal.seedLayout(layout);
    assert.notEqual(journal.session, draftSession);
    assert.deepEqual(await fs.readdir(d.capture), []);
    journal.start(10000); await journal.flush();
    const recording = (await readRecordedBoard(d.capture, 5))!;
    assert.equal(boardAt(recording, 0).items[0].kind, 'text');
    assert.equal(boardAt(recording, 0).visible, true);
    assert.ok(recording.events.every(event => event.t === 0));
    await journal.append({ ...text, id: 'during', text: '录中内容' }, 12000);
    assert.equal(journal.events.at(-1)?.t, 2);
    assert.deepEqual(await fs.readFile(path.join(d.draft, 'whiteboard.jsonl')), before);
    const next = path.join(d.root, 'next'); await fs.mkdir(next);
    await journal.reset(next); journal.start(20000); await journal.flush();
    assert.equal(await readRecordedBoard(next, 5), undefined, 'Previous recording never becomes an implicit preparation');
  } finally { await fs.rm(d.root, { recursive: true, force: true }); }
});

test('draft image assets are served before capture starts and copied after start, with live output authority', async () => {
  const d = await directories();
  try {
    const journal = new WhiteboardJournal(); await journal.startPreview(d.draft);
    const asset = randomUUID(), png = Buffer.alloc(40);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.write('IHDR', 12); png.writeUInt32BE(100, 16); png.writeUInt32BE(100, 20);
    await fs.mkdir(path.join(d.draft, 'whiteboard-assets'));
    await fs.writeFile(path.join(d.draft, 'whiteboard-assets', `${asset}.png`), png);
    await journal.append({ kind: 'image', id: 'photo', asset, color: '#202020', size: 3,
      x: 0, y: 0, width: 100, height: 100, caption: '' });
    await journal.reset(d.capture, true);
    assert.equal(await journal.assetFile(journal.session, asset), path.join(d.draft, 'whiteboard-assets', `${asset}.png`));
    assert.deepEqual(await fs.readdir(d.capture), []);
    journal.start(1000); await journal.flush();
    assert.equal(await journal.assetFile(journal.session, asset), path.join(d.capture, 'whiteboard-assets', `${asset}.png`));
    assert.deepEqual(await fs.readFile(path.join(d.capture, 'whiteboard-assets', `${asset}.png`)), png);
    assert.equal((await readRecordedBoard(d.capture, 1))?.separateCanvas, true);
    await assert.rejects(journal.assetFile('stale', asset), /失效/);
  } finally { await fs.rm(d.root, { recursive: true, force: true }); }
});

test('reopening a preparation repairs only the interrupted append and keeps it after an unsuccessful recording start', async () => {
  const d = await directories();
  try {
    const first = new WhiteboardJournal(); await first.startPreview(d.draft);
    await first.append(text); await first.flush();
    await fs.appendFile(path.join(d.draft, 'whiteboard.jsonl'), '{"t":');
    const recovered = new WhiteboardJournal(); await recovered.startPreview(d.draft);
    assert.equal(recovered.events.length, 1); await recovered.append({ ...text, id: 'second' });
    await recovered.reset(d.capture); // Failed native startup: no start(), no project writes.
    await recovered.startPreview(d.draft);
    assert.equal(recovered.events.length, 2);
    assert.deepEqual(await fs.readdir(d.capture), []);
    assert.equal((await readRecordedBoard(d.draft, 0))?.events.length, 2);
  } finally { await fs.rm(d.root, { recursive: true, force: true }); }
});

test('draft transfer flattens deletions, undo, focus and layout while splitting long strokes into valid replay chunks', () => {
  const events: BoardEvent[] = [{ t: 0, action: text }, { t: 1, action: { ...text, id: 'deleted' } },
    { t: 2, action: { kind: 'delete', id: 'deleted' } },
    { t: 3, action: { kind: 'stroke', id: 'stroke', color: '#202020', size: 3,
      points: Array.from({ length: 256 }, (_, x) => ({ x, y: 0 })) } },
    { t: 4, action: { kind: 'stroke', id: 'stroke', color: '#202020', size: 3,
      points: Array.from({ length: 256 }, (_, x) => ({ x: 256 + x, y: 0 })) } },
    { t: 5, action: { kind: 'viewport', view: { x: 10, y: 20, zoom: 1.2 } } }];
  const initial = draftContent(events);
  const validated = parseBoardRecording({ events: initial }, 1);
  const scene = validated.events.reduce(applyBoardEvent, emptyBoard());
  assert.deepEqual(scene.items, events.reduce(applyBoardEvent, emptyBoard()).items);
  assert.deepEqual(scene.view, { x: 10, y: 20, zoom: 1.2 });
  assert.ok(initial.every(event => event.t === 0));
});

test('a new board drops content, undo and view while keeping earlier recording timestamps replayable', async () => {
  const d = await directories();
  try {
    const started = Date.now() - 1000;
    const journal = new WhiteboardJournal(); await journal.reset(d.capture); journal.start(started);
    await journal.append(layout, started + 100); await journal.append(text, started + 200);
    await journal.append({ kind: 'viewport', view: { x: 80, y: 40, zoom: 2 } }, started + 300);
    const before = journal.session; await journal.newBoard();
    assert.notEqual(journal.session, before);
    await journal.append({ kind: 'undo' }); await journal.append({ kind: 'redo' }); await journal.flush();
    const recording = (await readRecordedBoard(d.capture, 24 * 3600))!;
    assert.equal(boardAt(recording, .25).items.length, 1);
    const after = boardAt(recording, 24 * 3600);
    assert.equal(after.items.length, 0); assert.equal(after.undo.length, 0); assert.equal(after.redo.length, 0);
    assert.equal(after.view, undefined); assert.equal(after.visible, true);
    assert.equal(boardAt(recording, .25).items[0].id, 'title', 'Seeking backwards retains the earlier board');
  } finally { await fs.rm(d.root, { recursive: true, force: true }); }
});

test('explicit fresh preview ignores the previous draft without modifying saved recordings', async () => {
  const d = await directories();
  try {
    const journal = new WhiteboardJournal(); await journal.startPreview(d.draft); await journal.append(text);
    await journal.reset(d.capture); journal.seedLayout(layout); journal.start(1000); await journal.flush();
    const saved = await fs.readFile(path.join(d.capture, 'whiteboard.jsonl'));
    await journal.startPreview(d.draft, true);
    assert.deepEqual(journal.events, []); assert.deepEqual(draftContent(journal.events), []);
    assert.deepEqual(await fs.readFile(path.join(d.capture, 'whiteboard.jsonl')), saved);
  } finally { await fs.rm(d.root, { recursive: true, force: true }); }
});
