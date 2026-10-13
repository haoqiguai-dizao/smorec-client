import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionDeletion } from '../shared/editor-selection';
import { decodingProject } from './fixtures/export-decoding';

test('deletion validates the selected object and protects the final source clip', () => {
  const project = decodingProject();
  assert.equal(selectionDeletion(project, null).enabled, false);
  assert.equal(selectionDeletion(project, { kind: 'clip', id: 'clip' }).reason, '至少保留一个视频片段');
  project.clips.push({ id: 'second', start: 3, end: 4 });
  assert.equal(selectionDeletion(project, { kind: 'clip', id: 'clip' }).enabled, true);
  assert.equal(selectionDeletion(project, { kind: 'clip', id: 'missing' }).enabled, false);
  project.zooms = [{ id: 'zoom', start: 1, end: 2, x: .5, y: .5, scale: 2 }];
  project.compositions = [{ id: 'local', start: 1, end: 2, screen: 'recording' }];
  assert.equal(selectionDeletion(project, { kind: 'zoom', id: 'zoom' }).label, '删除镜头');
  assert.equal(selectionDeletion(project, { kind: 'zoom', id: 'zoom' }).enabled, true);
  assert.equal(selectionDeletion(project, { kind: 'composition', id: 'local' }).enabled, true);
  project.compositions = [];
  assert.equal(selectionDeletion(project, { kind: 'composition', id: 'local' }).reason, '所选内容已不存在');
});
