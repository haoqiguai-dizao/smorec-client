import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBoardEvent, boardAt, emptyBoard } from '../shared/whiteboard/model';
import { beginBoardReveal, boardGraphemes, boardHasReveal, boardRevealAt } from '../shared/whiteboard/motion';
import type { BoardAction, BoardEvent, BoardLine, BoardRecording, BoardShape } from '../shared/whiteboard/types';
import { parseBoardAction, parseBoardRecording } from '../shared/whiteboard/validation';
import { draftContent } from '../electron/services/whiteboard/draft';
import { whiteboardFocusActivity } from '../shared/auto-zoom/whiteboard';
import { drawRecordedBoard, paintBoard } from '../src/services/whiteboard-renderer';
import { paintBoardText } from '../src/services/whiteboard-paint-text';

const shape: BoardShape = { kind: 'shape', id: 'voice', shape: 'rectangle', color: '#20242c', size: 3,
  x: 100, y: 100, width: 220, height: 120, text: '提出想法' };
const line: BoardLine = { kind: 'line', id: 'arrow', color: '#20242c', size: 3, arrow: true,
  start: { x: 320, y: 160 }, end: { x: 620, y: 160 } };
const layout: BoardEvent = { t: 0, action: { kind: 'layout', visible: true,
  bounds: { x: 0, y: 0, width: 1, height: 1 } } };
const recording: BoardRecording = { events: [layout, { t: 1, action: { kind: 'reveal', element: shape } }] };

function context() {
  const values: Record<string, unknown> = {}, stack: Record<string, unknown>[] = [];
  const calls: { name: string; args: unknown[]; styles: Record<string, unknown> }[] = [];
  const ctx = new Proxy(values, { get(target, name) {
    if (name === 'save') return () => stack.push({ ...values });
    if (name === 'restore') return () => {
      for (const key of Object.keys(values)) delete values[key]; Object.assign(values, stack.pop());
    };
    if (name === 'measureText') return (text: string) => ({ width: boardGraphemes(text).length * 26 });
    if (name in target) return target[String(name)];
    return (...args: unknown[]) => calls.push({ name: String(name), args, styles: { ...values } });
  } }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, stack };
}
function render(time: number) {
  const fixture = context(); drawRecordedBoard(fixture.ctx, recording, time, 0, 0, 1200, 700); return fixture;
}
const textCalls = (fixture: ReturnType<typeof context>) => fixture.calls.filter(call => call.name === 'fillText');

test('reveal records validate and round trip; unrelated objects cannot request this animation', () => {
  for (const element of [shape, line]) {
    const action = { kind: 'reveal', element };
    assert.deepEqual(parseBoardAction(action), action);
    assert.deepEqual(parseBoardRecording({ events: [{ t: 1, action }] }, 2).events[0].action, action);
  }
  assert.throws(() => parseBoardAction({ kind: 'reveal', element: {
    kind: 'text', id: 'bad', x: 0, y: 0, text: 'bad', color: '#20242c', size: 20 } }), /动效只支持/);
});

test('source-time outline, typing and completion survive backwards seeking without mutating text', () => {
  assert.equal(render(.9).calls.some(call => call.name === 'stroke'), false);
  const outline = render(1.4);
  assert.ok(outline.calls.some(call => call.name === 'stroke' && Number(call.styles.lineDashOffset) > 0));
  assert.equal(textCalls(outline).length, 0);
  const typing = render(2.21); assert.equal(textCalls(typing)[0].args[0], '提出');
  assert.equal(textCalls(render(3))[0].args[0], shape.text);
  assert.deepEqual(render(1.4).calls, outline.calls);
  assert.equal((boardAt(recording, 2.21).items[0] as BoardShape).text, shape.text);
  assert.equal(typing.stack.length, 0);
});

test('live and recorded painters produce identical content at the same elapsed time', () => {
  const live = applyBoardEvent(emptyBoard(), { t: 100, action: { kind: 'reveal', element: shape } });
  for (const elapsed of [.4, 1.21, 2.4]) {
    const fixture = context(); paintBoard(fixture.ctx, live, 1200, 700, undefined, false, 100 + elapsed);
    const replay = context(); paintBoard(replay.ctx, boardAt(recording, 1 + elapsed), 1200, 700, undefined, false, 1 + elapsed);
    assert.equal(textCalls(fixture)[0]?.args[0], textCalls(replay)[0]?.args[0]);
    const a = fixture.calls.find(call => call.name === 'stroke')?.styles.lineDashOffset;
    const b = replay.calls.find(call => call.name === 'stroke')?.styles.lineDashOffset;
    if (typeof a === 'number' && typeof b === 'number') assert.ok(Math.abs(a - b) < 1e-8);
    else assert.equal(a, b);
  }
});

test('partial text reserves its complete width, including compression and intact emoji graphemes', () => {
  const fixture = context(); fixture.ctx.textAlign = 'center';
  paintBoardText(fixture.ctx, '提出想法', 210, 160, { color: shape.color, size: 26, visibleCharacters: 2 });
  assert.equal(textCalls(fixture)[0].args[0], '提出'); assert.equal(textCalls(fixture)[0].args[1], 158);
  const compressed = context(); compressed.ctx.textAlign = 'center';
  paintBoardText(compressed.ctx, '提出想法', 210, 160, { color: shape.color, size: 26, maxWidth: 52, visibleCharacters: 2 });
  assert.equal(textCalls(compressed)[0].args[1], 368);
  assert.deepEqual(boardGraphemes('👨‍👩‍👧‍👦好'), ['👨‍👩‍👧‍👦', '好']);
  const emoji = context(); paintBoardText(emoji.ctx, '👨‍👩‍👧‍👦好', 100, 100,
    { color: shape.color, size: 26, visibleCharacters: 1 });
  assert.equal(textCalls(emoji)[0].args[0], '👨‍👩‍👧‍👦');
  assert.notEqual(boardRevealAt(shape, 1, 2.1)?.caret, boardRevealAt(shape, 1, 2.2)?.caret);
});

test('moving, editing, deletion, clear, undo and redo cancel entrances instead of replaying them', () => {
  for (const action of [{ kind: 'replace', gesture: 'move', element: { ...shape, x: 300 } },
    { kind: 'replace', gesture: 'edit', element: { ...shape, text: '新文字' } },
    { kind: 'delete', id: shape.id }, { kind: 'clear' }, { kind: 'undo' }] as BoardAction[]) {
    const scene = applyBoardEvent(boardAt(structuredClone(recording), 1.1), { t: 1.2, action });
    assert.equal(boardHasReveal(scene.items, scene.reveals, 1.3), false);
    if (action.kind === 'undo') {
      const redone = applyBoardEvent(scene, { t: 1.3, action: { kind: 'redo' } });
      assert.equal(boardHasReveal(redone.items, redone.reveals, 1.3), false);
      assert.deepEqual(redone.items, [shape]);
    }
  }
});

test('preparation content and legacy recordings remain static; completed animations do not require redraw', () => {
  const initial = draftContent(recording.events);
  assert.equal(initial.some(event => event.action.kind === 'reveal'), false);
  const scene = initial.reduce(applyBoardEvent, emptyBoard());
  assert.deepEqual(scene.items, [shape]); assert.equal(scene.reveals, undefined);
  assert.equal(boardHasReveal(boardAt(recording, 4).items, boardAt(recording, 4).reveals, 4), false);
  assert.equal(boardRevealAt({ ...shape, shape: 'text' }, 1, 1.4)?.outline, 1);
  assert.equal(boardRevealAt(shape, undefined, 1.1), undefined);
});

test('the connector grows first and its arrowhead draws only after the curve arrives', () => {
  const animated: BoardRecording = { events: [layout, { t: 1, action: { kind: 'reveal', element: line } }] };
  const before = context(); drawRecordedBoard(before.ctx, animated, 1.3, 0, 0, 1200, 700);
  assert.equal(before.calls.filter(call => call.name === 'stroke').length, 1);
  assert.ok(before.calls.some(call => call.name === 'stroke' && Number(call.styles.lineDashOffset) > 0));
  const after = context(); drawRecordedBoard(after.ctx, animated, 1.62, 0, 0, 1200, 700);
  const strokes = after.calls.filter(call => call.name === 'stroke');
  assert.equal(strokes.length, 2); assert.equal(strokes[0].styles.lineDashOffset, 0);
  assert.ok(Number(strokes[1].styles.lineDashOffset) > 0);
  const finished = context(); drawRecordedBoard(finished.ctx, animated, 2, 0, 0, 1200, 700);
  assert.equal(finished.calls.filter(call => call.name === 'stroke').length, 2);
});

test('revealed nodes retain automatic focus and one-step undo', () => {
  const focus = whiteboardFocusActivity(recording, 4, 1200, 700);
  assert.ok(focus.some(item => item.t === 1 && item.kind === 'typing'));
  const scene = boardAt(recording, 1); assert.equal(scene.undo.length, 1);
  const undone = applyBoardEvent(scene, { t: 2, action: { kind: 'undo' } });
  assert.equal(undone.items.length, 0);
});

const connectedLine: BoardLine = { ...line, start: { ...line.start, shapeId: 'source' }, end: { ...line.end, shapeId: shape.id } };
const connected: BoardAction = { kind: 'connect-node', line: connectedLine, node: shape, reveal: true };
const spokenText: BoardAction = { kind: 'replace', gesture: 'speech', element: { ...shape, text: '新的语音文字' }, reveal: 'text' };

test('new connector and spoken-text motion flags round trip without accepting unrelated animation modes', () => {
  for (const action of [connected, spokenText]) {
    assert.deepEqual(parseBoardAction(action), action);
    assert.deepEqual(parseBoardRecording({ events: [{ t: 1, action }] }, 2).events[0].action, action);
  }
  assert.throws(() => parseBoardAction({ ...connected, reveal: 'text' }), /新节点动效/);
  assert.throws(() => parseBoardAction({ ...spokenText, reveal: true }), /文字动效/);
  assert.throws(() => parseBoardAction({ ...spokenText, element: line }), /文字动效/);
});

test('a dragged connector animates only its new node and keeps its completed line and single undo', () => {
  const source = { ...shape, id: 'source', x: -200 };
  let scene = applyBoardEvent(emptyBoard(), { t: 0, action: source });
  scene = applyBoardEvent(scene, { t: .5, action: connectedLine });
  const completed = applyBoardEvent(scene, { t: 1, action: connected });
  assert.equal(completed.undo.length, scene.undo.length);
  assert.ok(boardRevealAt(shape, completed.reveals?.[shape.id], 1.4)!.outline < 1);
  assert.equal(completed.reveals?.[line.id], undefined);
  const duplicate = applyBoardEvent(completed, { t: 1.5, action: connected });
  assert.equal(duplicate, completed, 'A duplicate completion must not create another node or restart motion');
  const undone = applyBoardEvent(completed, { t: 2, action: { kind: 'undo' } });
  assert.deepEqual(undone.items, [source]);
  const redone = applyBoardEvent(undone, { t: 3, action: { kind: 'redo' } });
  assert.deepEqual(redone.items, completed.items);
  assert.equal(boardHasReveal(redone.items, redone.reveals, 3), false);
});

test('spoken text keeps the original outline complete while only its letters enter', () => {
  const scene = applyBoardEvent(applyBoardEvent(emptyBoard(), { t: 0, action: shape }), { t: 1, action: spokenText });
  const updated = scene.items[0] as BoardShape;
  assert.deepEqual({ ...updated, text: shape.text }, shape, 'Geometry, shape and style must be unchanged');
  const progress = boardRevealAt(updated, scene.reveals?.[shape.id], 1.4)!;
  assert.equal(progress.outline, 1); assert.ok(progress.text > 0 && progress.text < 1);
  const fixture = context(); paintBoard(fixture.ctx, scene, 1200, 700, undefined, false, 1.4);
  assert.ok(fixture.calls.some(call => call.name === 'stroke'));
  assert.equal(fixture.calls.some(call => call.name === 'setLineDash'), false, 'Text must not redraw a partial outline');
  assert.notEqual(textCalls(fixture)[0].args[0], updated.text);
  const undone = applyBoardEvent(scene, { t: 2, action: { kind: 'undo' } });
  assert.deepEqual(undone.items, [shape]);
  assert.equal(boardHasReveal(undone.items, undone.reveals, 2), false);
});

test('new paths share live/replay/export progress, including backward seeks and completed frames', () => {
  const spoken: BoardRecording = { events: [layout, { t: 0, action: shape }, { t: 1, action: spokenText }] };
  const live = applyBoardEvent(applyBoardEvent(emptyBoard(), { t: 99, action: shape }), { t: 100, action: spokenText });
  for (const elapsed of [.01, .4, 1.2, 3, .4]) {
    const a = context(); paintBoard(a.ctx, live, 1200, 700, undefined, false, 100 + elapsed);
    const b = context(); drawRecordedBoard(b.ctx, spoken, 1 + elapsed, 0, 0, 1200, 700);
    assert.deepEqual(textCalls(a).map(call => call.args[0]), textCalls(b).map(call => call.args[0]));
    assert.equal(boardAt(spoken, 1 + elapsed).items.length, 1);
  }
  assert.equal((boardAt(spoken, 4).items[0] as BoardShape).text, '新的语音文字');
});

test('legacy operations and prepared content stay static; ordinary edits interrupt new animations', () => {
  const legacy = applyBoardEvent(emptyBoard(), { t: 1, action: { kind: 'connect-node', line: connectedLine, node: shape } });
  assert.equal(boardHasReveal(legacy.items, legacy.reveals, 1.1), false);
  const events: BoardEvent[] = [{ t: 0, action: shape }, { t: 1, action: spokenText }];
  const prepared = draftContent(events).reduce(applyBoardEvent, emptyBoard());
  assert.equal(boardHasReveal(prepared.items, prepared.reveals, .1), false);
  const moved = applyBoardEvent(events.reduce(applyBoardEvent, emptyBoard()), { t: 1.2,
    action: { kind: 'replace', gesture: 'move', element: { ...shape, x: 300 } } });
  assert.equal(boardHasReveal(moved.items, moved.reveals, 1.3), false);
  const missing = applyBoardEvent(emptyBoard(), { t: 1, action: spokenText });
  assert.equal(missing.items.length, 0); assert.equal(missing.reveals, undefined);
});

test('text-only reveals support pure text, Unicode clusters and bounded cleanup without outline delays', () => {
  const text = { ...shape, shape: 'text' as const, text: '👨‍👩‍👧‍👦你好' };
  const reveal = boardRevealAt(text, { t: 1, textOnly: true }, 1.4)!;
  assert.equal(reveal.outline, 1); assert.ok(Math.abs(reveal.text - .5) < 1e-8);
  assert.equal(boardRevealAt({ ...text, text: '' }, { t: 1, textOnly: true }, 1), undefined);
  assert.equal(boardRevealAt(text, { t: 1, textOnly: true }, 2), undefined);
  assert.deepEqual(beginBoardReveal({ old: { t: 0, textOnly: true }, current: 2 }, 'new', 4, true),
    { current: 2, new: { t: 4, textOnly: true } });
});
