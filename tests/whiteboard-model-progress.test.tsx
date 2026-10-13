import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { WhiteboardModelProgress } from '../src/components/whiteboard/WhiteboardModelProgress';
import { WhiteboardSpeechStatus } from '../src/components/whiteboard/WhiteboardSpeechStatus';

test('model download presents a bounded accessible percentage and byte capacity', () => {
  const html = renderToStaticMarkup(<WhiteboardModelProgress model={{ phase: 'downloading', received: 1048576, total: 2097152 }} />);
  assert.match(html, /aria-valuenow="50"/); assert.match(html, /下载模型 50%/);
  assert.match(html, /1\.0.*2\.0 MB/);
});
test('failed download keeps retry visible and exposes the reason instead of silently repeating installation', () => {
  const html = renderToStaticMarkup(<WhiteboardSpeechStatus phase="needs-model" error="网络下载超时"
    install={async () => {}} cancel={() => {}} />);
  assert.match(html, /下载失败，重试/); assert.match(html, /title="网络下载超时"/);
  assert.doesNotMatch(html, /下载本机语音模型/);
});
