import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { WhiteboardJournal } from '../electron/services/whiteboard/journal';
import { LiveBoardPlayback } from '../src/services/live/whiteboard';
import { applyBoardEvent, emptyBoard } from '../shared/whiteboard/model';
import type { LiveWhiteboard } from '../electron/services/live/whiteboard';

const bundled = build({ entryPoints: ['electron/services/live/whiteboard.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });

test('reopening a live board resets ink while keeping the continuous delivery session and event cursor', async () => {
  const directory = await fs.mkdtemp('/private/tmp/xiaolu-live-board-test-');
  const journal = new WhiteboardJournal(), playback = new LiveBoardPlayback();
  const module = { exports: {} as { LiveWhiteboard: typeof LiveWhiteboard } }, require = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', (await bundled).outputFiles[0].text)(
    (name: string) => name === 'electron' ? { app: { getPath: () => directory } } : require(name), module, module.exports);
  const statuses: string[] = [];
  const live = new module.exports.LiveWhiteboard(journal, { preparing() {}, prepare: async () => 'handle',
    update: (state: { status: string }) => { statuses.push(state.status); } } as never);
  try {
    await live.prepare({ id: 'screen:1', kind: 'screen', name: 'synthetic', width: 1280, height: 720 }, { sourceId: 'screen:1' });
    await live.started(Date.now());
    const deliverySession = journal.session;
    for (let opening = 0; opening < 5; opening++) {
      await journal.newBoard();
      assert.notEqual(journal.session, deliverySession);
      await journal.append({ kind: 'text', id: 'ink-' + opening, x: 10, y: 10, color: '#000000', size: 32, text: String(opening) });
      const frame = live.pull()!;
      assert.equal(frame.session, deliverySession);
      assert.doesNotThrow(() => playback.ingest(frame));
      const scene = playback.recording.events.reduce(applyBoardEvent, emptyBoard());
      assert.deepEqual(scene.items.map(item => item.id), ['ink-' + opening]);
      const empty = live.pull()!;
      assert.equal(empty.events.length, 0); assert.doesNotThrow(() => playback.ingest(empty));
    }
    assert.deepEqual(statuses, ['recording']);
    await live.restore(); assert.equal(live.pull(), undefined);
    assert.deepEqual(await fs.readdir(directory), [], 'Owned live assets are reclaimed after stopping');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
