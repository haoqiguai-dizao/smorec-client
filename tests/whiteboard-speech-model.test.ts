import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import type { SpeechModel } from '../electron/services/whiteboard/speech-model';
import type { SpeechModelFetch } from '../electron/services/whiteboard/speech-model-download';
import { missingSpeechModel } from '../src/services/whiteboard-speech-state';
import { speechModelSources } from '../electron/services/whiteboard/speech-model-files';

const bytes = Buffer.from('deterministic pinned model content'), tokenBytes = Buffer.from('pinned tokens');
const files = [bytes, tokenBytes].map((value, index) => ({ name: index ? 'tokens.txt' : 'model.int8.onnx',
  bytes: value.length, sha256: createHash('sha256').update(value).digest('hex') }));
const bundle = build({ entryPoints: ['electron/services/whiteboard/speech-model.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'model-fixture', setup(builder) {
    builder.onResolve({ filter: /^(electron|\.\.\/diagnostics)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'electron'
      ? 'export const app={},net={};' : 'export const diagnostic=()=>{};' }));
  } }] });
async function fixture(fetcher: SpeechModelFetch) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-model-'));
  const module = { exports: {} as { SpeechModel: typeof SpeechModel } };
  new Function('require', 'module', 'exports', (await bundle).outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const model = () => new module.exports.SpeechModel({ directory: () => directory, files, fetcher,
    sources: ['https://primary.test/', 'https://mirror.test/'] });
  return { directory, model, close: () => fs.rm(directory, { recursive: true, force: true }) };
}
function answer(url: string, init?: RequestInit): Response {
  const value = url.endsWith('tokens.txt') ? tokenBytes : bytes;
  const start = Number(new Headers(init?.headers).get('range')?.match(/bytes=(\d+)-/)?.[1] ?? 0);
  return new Response(value.subarray(start), { status: start ? 206 : 200, headers: {
    'content-length': String(value.length - start), ...(start ? { 'content-range': `bytes ${start}-${value.length - 1}/${value.length}` } : {}),
  } });
}
test('download reports bytes and completion, shares requests and persists readiness across restarts', async () => {
  let calls = 0; const f = await fixture(async (url, init) => { calls++; return answer(url, init); });
  try {
    const model = f.model(), states: ReturnType<SpeechModel['snapshot']>[] = [];
    model.onState = () => states.push(model.snapshot());
    await Promise.all([model.install(), model.install()]); assert.equal(calls, 2);
    assert.equal(await model.ready(), true); assert.equal(await f.model().ready(), true); assert.equal(calls, 2);
    assert.ok(states.some(state => state.phase === 'downloading'));
    assert.equal(states.at(-1)?.phase, 'ready'); assert.equal(states.at(-1)?.received, bytes.length + tokenBytes.length);
  } finally { await f.close(); }
});
test('domestic mirror resumes a partial file after primary fails and still validates the complete hash', async () => {
  const ranges: string[] = [];
  const f = await fixture(async (url, init) => {
    if (url.startsWith('https://primary')) throw new Error('network unavailable');
    ranges.push(new Headers(init?.headers).get('range') ?? ''); return answer(url, init);
  });
  try {
    await fs.writeFile(path.join(f.directory, 'model.int8.onnx.download'), bytes.subarray(0, 9));
    const model = f.model(); await model.install(); assert.equal(await model.ready(), true);
    assert.equal(ranges[0], 'bytes=9-'); assert.deepEqual(await fs.readFile(model.paths().model), bytes);
  } finally { await f.close(); }
});
test('wrong same-size model is discarded before trying mirror', async () => {
  const f = await fixture(async (url, init) => url.includes('primary')
    ? new Response(Buffer.alloc(url.endsWith('tokens.txt') ? tokenBytes.length : bytes.length), { headers: {
      'content-length': String(url.endsWith('tokens.txt') ? tokenBytes.length : bytes.length) } }) : answer(url, init));
  try { const model = f.model(); await model.install(); assert.deepEqual(await fs.readFile(model.paths().model), bytes); }
  finally { await f.close(); }
});
test('truncated download remains resumable, publishes failure, and retry never marks an incomplete file ready', async () => {
  let fail = true;
  const f = await fixture(async (url, init) => fail
    ? new Response(bytes.subarray(0, 7)) : answer(url, init));
  try {
    const model = f.model(); await assert.rejects(model.install()); assert.equal(await model.ready(), false);
    assert.equal(model.snapshot().phase, 'error'); assert.ok(model.snapshot().error);
    await assert.rejects(fs.stat(model.paths().model));
    fail = false; await model.install(); assert.equal(await model.ready(), true);
  } finally { await f.close(); }
});
test('unexpected Range response is rejected without appending to the partial file', async () => {
  const f = await fixture(async () => new Response(bytes, { status: 206,
    headers: { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` } }));
  try {
    const partial = path.join(f.directory, 'model.int8.onnx.download'); await fs.writeFile(partial, bytes.subarray(0, 7));
    await assert.rejects(f.model().install(), /续传响应无效/); assert.equal((await fs.readFile(partial)).length, 7);
  } finally { await f.close(); }
});
test('model loading failures do not send users back into a download loop, and default sources are domestic', () => {
  assert.equal(missingSpeechModel(new Error('先下载本机语音模型，或使用文字工具手动输入')), true);
  for (const text of ['本机语音模型加载失败', '本机语音模型加载超时', '本机识别程序启动失败']) assert.equal(missingSpeechModel(new Error(text)), false);
  assert.deepEqual(speechModelSources.map(url => new URL(url).host), ['www.modelscope.cn', 'hf-mirror.com']);
});
