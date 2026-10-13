import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyBoard, applyBoardAction } from '../shared/whiteboard/model';
import type { BoardElement, BoardRecording, BoardShape } from '../shared/whiteboard/types';
import { boardSpeechText } from '../shared/whiteboard/speech-text';
import { paintBoard, drawRecordedBoard } from '../src/services/whiteboard-renderer';
import { diagramStroke } from '../src/services/whiteboard-diagram-style';

function context() {
  const styles: Record<string, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1 };
  const stack: Record<string, unknown>[] = [];
  const calls: { method: string; args: unknown[]; styles: Record<string, unknown> }[] = [];
  const ctx = new Proxy(styles, { get: (target, name) => {
    if (name === 'save') return () => stack.push({ ...styles });
    if (name === 'restore') return () => {
      for (const key of Object.keys(styles)) delete styles[key]; Object.assign(styles, stack.pop());
    };
    if (name in target) return target[String(name)];
    return (...args: unknown[]) => calls.push({ method: String(name), args, styles: { ...styles } });
  } }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, stack };
}
const shape: BoardShape = { kind: 'shape', id: 'shape', shape: 'rectangle', color: '#3074e8', size: 4,
  x: 80, y: 80, width: 200, height: 110, text: '图形文字' };
const elements: BoardElement[] = [shape, { ...shape, id: 'plain', shape: 'text', x: 400, text: '语音纯文字' },
  { kind: 'text', id: 'text', color: '#e94b59', size: 32, x: 80, y: 300, text: '普通文字' },
  { kind: 'image', id: 'image', asset: 'test', color: '#20242c', size: 4,
    x: 800, y: 80, width: 200, height: 140, caption: '图片注释' }];
const scene = elements.reduce((value, item) => applyBoardAction(value, item), emptyBoard());

test('dictation omits a final sentence stop without stripping internal punctuation, decimals or emphasis', () => {
  for (const value of [' 下一步。 \n', '下一步.', '下一步．', '下一步。。']) assert.equal(boardSpeechText(value), '下一步');
  assert.equal(boardSpeechText('版本 0.9.68，先测试。再发布。'), '版本 0.9.68，先测试。再发布');
  for (const value of ['数值 2.5', '确认？', '完成！', '还没结束…', 'Wait...']) assert.equal(boardSpeechText(value), value);
  assert.equal(boardSpeechText(' 。 '), ''); assert.equal(boardSpeechText(' \n '), '');
});

test('transparent live text uses white fill with a dark outline and never changes stored colors', () => {
  const before = JSON.stringify(scene), f = context(); paintBoard(f.ctx, scene, 1200, 700, undefined, true);
  const fills = f.calls.filter(call => call.method === 'fillText'), outlines = f.calls.filter(call => call.method === 'strokeText');
  assert.equal(fills.length, elements.length); assert.equal(outlines.length, fills.length);
  assert.ok(fills.every(call => call.styles.fillStyle === '#ffffff'));
  assert.ok(outlines.every(call => call.styles.strokeStyle === '#172033' && Number(call.styles.lineWidth) >= 2.5));
  assert.equal(JSON.stringify(scene), before); assert.equal(f.stack.length, 0);
});

test('recorded pure canvas keeps original colors and contains no live contrast outline', () => {
  const recording: BoardRecording = { events: [{ t: 0, action: { kind: 'layout', visible: true,
    bounds: { x: 0, y: 0, width: 1, height: 1 } } }, ...elements.map(action => ({ t: 1, action }))] };
  const f = context(); drawRecordedBoard(f.ctx, recording, 2, 0, 0, 1200, 700);
  const fills = f.calls.filter(call => call.method === 'fillText'); assert.equal(fills.length, elements.length);
  fills.forEach((call, index) => assert.equal(call.styles.fillStyle, elements[index].color));
  assert.equal(f.calls.some(call => call.method === 'strokeText'), false);
  assert.ok(f.calls.some(call => call.method === 'fillRect' && call.styles.fillStyle === '#ffffff'));
});

test('diagram styling retains thickness ordering, rounded corners and tangent-aligned light arrowheads', () => {
  assert.ok(diagramStroke(2) < diagramStroke(4) && diagramStroke(4) < diagramStroke(8));
  const line: BoardElement = { kind: 'line', id: 'line', color: '#e94b59', size: 4, arrow: true,
    start: { x: 80, y: 600 }, end: { x: 500, y: 600 } };
  const styled = applyBoardAction(applyBoardAction(scene, { ...shape, id: 'diamond', shape: 'diamond', x: 450 }), line);
  const f = context(); paintBoard(f.ctx, styled, 1200, 700);
  assert.ok(f.calls.some(call => call.method === 'roundRect' && call.args[4] === 20));
  assert.ok(f.calls.some(call => call.method === 'quadraticCurveTo'));
  const strokes = f.calls.filter(call => call.method === 'stroke' && call.styles.strokeStyle === line.color);
  assert.equal(strokes.length, 2); assert.ok(strokes.every(call => call.styles.lineCap === 'round'));
});
