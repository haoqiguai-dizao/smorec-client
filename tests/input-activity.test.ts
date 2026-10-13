import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseInputActivity, MAX_INPUT_ACTIVITY_EVENTS } from '../electron/services/input-activity';
import { recoverInputActivity } from '../electron/services/input-activity-recovery';
import { parseProject } from '../electron/services/validation';
import { DEFAULT_STYLE } from '../shared/constants';

function project(inputActivity?: unknown) {
  return { id: '12345678-1234-1234-1234-123456789abc', name: 'Input activity fixture',
    createdAt: '2026-09-08T00:00:00Z', duration: 10, width: 1280, height: 720, fps: 30,
    media: { screen: 'screen.mp4' }, cursor: [], clips: [{ id: 'clip', start: 0, end: 10 }],
    zooms: [], style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 },
    ...(inputActivity === undefined ? {} : { inputActivity }) };
}

test('input activity contains only detached source-clock typing and reset events', () => {
  const events = [{ t: 0, kind: 'reset' }, { t: 0, kind: 'typing' }, { t: 10, kind: 'reset' }];
  const parsed = parseInputActivity(events, 10);
  assert.deepEqual(parsed, events);
  assert.notEqual(parsed, events);
  assert.notEqual(parsed[0], events[0]);
  assert.deepEqual(parseProject(project(events)).inputActivity, parsed);
  assert.equal(Object.hasOwn(parseProject(project()), 'inputActivity'), false, 'Legacy projects stay byte-shape compatible');
  assert.deepEqual(parseProject(project([])).inputActivity, []);
});

test('input activity rejects key data, invalid clocks, unordered events and oversized arrays', () => {
  for (const invalid of [null, {}, [{ t: -1, kind: 'typing' }], [{ t: 11, kind: 'reset' }],
    [{ t: NaN, kind: 'typing' }], [{ t: Infinity, kind: 'typing' }], [{ t: '1', kind: 'typing' }],
    [{ t: 1, kind: 'keydown' }], [{ t: 1 }], [{ kind: 'typing' }],
    [{ t: 2, kind: 'reset' }, { t: 1, kind: 'typing' }], new Array(MAX_INPUT_ACTIVITY_EVENTS + 1)]) {
    assert.throws(() => parseInputActivity(invalid, 10));
    assert.throws(() => parseProject(project(invalid)));
  }
  for (const field of ['key', 'keyCode', 'scanCode', 'text', 'windowTitle', 'hwnd']) {
    assert.throws(() => parseInputActivity([{ t: 1, kind: 'typing', [field]: 'must not persist' }], 10));
  }
  for (const duration of [-1, NaN, Infinity]) assert.throws(() => parseInputActivity([], duration));
});

async function fixture(run: (directory: string) => Promise<void>) {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'input-activity-test-'));
  try { await run(directory); }
  finally {
    const real = await fs.realpath(directory), relative = path.relative(output, real);
    assert.ok(relative.startsWith('input-activity-test-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    assert.equal((await fs.lstat(directory)).isSymbolicLink(), false);
    await fs.rm(real, { recursive: true, force: true });
  }
}

test('input activity recovery normalizes the common clock and clips preparation and shutdown', async () => {
  await fixture(async directory => {
    assert.deepEqual(await recoverInputActivity(directory, 2, 10), {});
    const events = [{ t: 1, kind: 'typing' }, { t: 2, kind: 'reset' }, { t: 3, kind: 'typing' },
      { t: 11, kind: 'typing' }, { t: 12, kind: 'reset' }, { t: 12.5, kind: 'reset' }];
    await fs.writeFile(path.join(directory, 'input-activity.recovery.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
    assert.deepEqual(await recoverInputActivity(directory, 2, 10), { inputActivity: [
      { t: 0, kind: 'reset' }, { t: 1, kind: 'typing' }, { t: 9, kind: 'typing' }, { t: 10, kind: 'reset' },
    ] });
    await fs.writeFile(path.join(directory, 'input-activity.json'), '[{"t":1,"kind":"typing"}]');
    assert.deepEqual(await recoverInputActivity(directory, 2, 10), { inputActivity: [{ t: 1, kind: 'typing' }] },
      'Final metadata is already normalized and takes precedence');
  });
});

test('damaged activity never bridges through an unknown reset and never blocks video recovery', async () => {
  await fixture(async directory => {
    const file = path.join(directory, 'input-activity.recovery.jsonl');
    for (const content of ['{"t":1,"kind":"typing"}\n{"t":',
      '{"t":1,"kind":"typing"}\ncorrupt\n{"t":3,"kind":"typing"}',
      '{"t":2,"kind":"typing"}\n{"t":1,"kind":"reset"}',
      '{"t":1,"kind":"typing","key":"private"}']) {
      await fs.writeFile(file, content);
      const result = await recoverInputActivity(directory, 0, 10);
      assert.equal(result.inputActivity, undefined);
      assert.ok(result.warning);
      assert.ok(!JSON.stringify(result).includes('private'));
    }
    await fs.writeFile(file, '{"t":1,"kind":"typing"}\n');
    await fs.writeFile(path.join(directory, 'input-activity.json'), 'corrupt');
    assert.ok((await recoverInputActivity(directory, 0, 10)).warning, 'Do not replace damaged final evidence with an older journal');
  });
});

test('recovery refuses directories masquerading as activity files', async () => {
  await fixture(async directory => {
    await fs.mkdir(path.join(directory, 'input-activity.json'));
    const result = await recoverInputActivity(directory, 0, 10);
    assert.equal(result.inputActivity, undefined);
    assert.ok(result.warning);
  });
});

test('focused input metadata validates and detaches only normalized position fields', () => {
  const events = [{ t: 1, kind: 'typing', focus: { x: 0, y: 1 } },
    { t: 2, kind: 'typing', focus: { x: 0.4, y: 0.7 } }, { t: 3, kind: 'reset' }];
  const parsed = parseInputActivity(events, 10);
  assert.deepEqual(parsed, events);
  assert.notEqual(parsed[0].focus, events[0].focus);
  assert.deepEqual(parseProject(project(events)).inputActivity, events);
  for (const focus of [null, [], {}, { x: 0.5 }, { x: '0.5', y: 0.5 },
    { x: NaN, y: 0.5 }, { x: 0.5, y: Infinity }, { x: -0.1, y: 0.5 }, { x: 0.5, y: 1.1 },
    { x: 0.5, y: 0.5, text: 'PRIVATE FIXTURE' }, { x: 0.5, y: 0.5, hwnd: 123 },
    { x: 0.5, y: 0.5, [Symbol('unknown')]: true }]) {
    assert.throws(() => parseInputActivity([{ t: 1, kind: 'typing', focus }], 10));
  }
  assert.throws(() => parseInputActivity([{ t: 1, kind: 'reset', focus: { x: 0.5, y: 0.5 } }], 10));
});

test('recovery retains normalized focus coordinates while converting only timestamps', async () => {
  await fixture(async directory => {
    const events = [{ t: 1, kind: 'typing', focus: { x: 0.1, y: 0.2 } },
      { t: 3, kind: 'typing', focus: { x: 0.6, y: 0.7 } }, { t: 5, kind: 'reset' }];
    const journal = path.join(directory, 'input-activity.recovery.jsonl');
    await fs.writeFile(journal, events.map(event => JSON.stringify(event)).join('\n'));
    assert.deepEqual(await recoverInputActivity(directory, 2, 5), { inputActivity: [
      { t: 1, kind: 'typing', focus: { x: 0.6, y: 0.7 } }, { t: 3, kind: 'reset' },
    ] });
    await fs.writeFile(journal, JSON.stringify({ t: 3, kind: 'typing', focus: { x: 0.6, y: 0.7, text: 'PRIVATE FIXTURE' } }));
    const damaged = await recoverInputActivity(directory, 2, 5);
    assert.equal(damaged.inputActivity, undefined);
    assert.ok(damaged.warning);
    assert.ok(!JSON.stringify(damaged).includes('PRIVATE FIXTURE'));
    await fs.writeFile(path.join(directory, 'input-activity.json'), JSON.stringify([{ t: 1, kind: 'typing', focus: { x: 0.2, y: 0.8 } }]));
    assert.deepEqual(await recoverInputActivity(directory, 2, 5), { inputActivity: [{ t: 1, kind: 'typing', focus: { x: 0.2, y: 0.8 } }] });
  });
});
