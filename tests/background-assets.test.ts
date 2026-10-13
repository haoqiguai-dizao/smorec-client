import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ffmpeg from 'ffmpeg-static';
import { backgroundCodec, normalizeBackgroundImage, normalizedPngSize, MAX_BACKGROUND_SOURCE_BYTES } from '../electron/services/background-image';
import { backgroundFile, backgroundView, parseBackgroundAssets } from '../electron/services/project-backgrounds';

async function raster(codec: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=32x24',
      '-frames:v', '1', '-threads', '1', '-c:v', codec, '-f', 'image2pipe', 'pipe:1'], { windowsHide: true });
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.resume();
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve(Buffer.concat(chunks)); else reject(new Error('Synthetic fixture encoder failed'));
    });
  });
}

test('background manifest schema accepts only unique registered-format UUID assets, never arbitrary paths or URLs', () => {
  const id = randomUUID(), projectId = randomUUID(), asset = { id, name: '  Fixture  ', src: `background-${id}.png` };
  assert.deepEqual(parseBackgroundAssets([asset]), [{ ...asset, name: 'Fixture' }]);
  assert.deepEqual(parseBackgroundAssets([backgroundView(projectId, asset)])[0].src, `frameflow://background/${projectId}/${id}`);
  for (const src of ['../image.png', 'C:\\private.png', 'https://example.com/image.png', 'data:image/png;base64,AAAA',
    `frameflow://background/${projectId}/${id}?filename=secret`, `background-${randomUUID()}.png`])
    assert.throws(() => parseBackgroundAssets([{ ...asset, src }]));
  for (const value of [undefined, {}, [asset, asset], [{ ...asset, id: '../../' }], [{ ...asset, name: '\0' }],
    Array.from({ length: 33 }, () => { const id = randomUUID(); return { id, name: 'Fixture', src: `background-${id}.png` }; })])
    assert.throws(() => parseBackgroundAssets(value));
});

test('background decoding whitelists only raster signatures and rejects oversized source data before decode', () => {
  for (const bytes of [Buffer.from('<svg><script/></svg>'), Buffer.from('GIF89a'), Buffer.alloc(0), Buffer.alloc(MAX_BACKGROUND_SOURCE_BYTES + 1)])
    assert.throws(() => backgroundCodec(bytes));
});

test('real bounded decoder normalizes synthetic PNG, JPEG and WebP to RGBA PNG and rejects corrupt input', async () => {
  for (const codec of ['png', 'mjpeg', 'libwebp']) {
    const input = await raster(codec);
    assert.equal(backgroundCodec(input), codec === 'libwebp' ? 'webp' : codec);
    const output = await normalizeBackgroundImage(input, ffmpeg!);
    assert.deepEqual(normalizedPngSize(output), { width: 32, height: 24 });
    assert.equal(output[25], 6, 'Normalized PNG is RGBA, not a retained third-party container');
  }
  const corrupt = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  await assert.rejects(normalizeBackgroundImage(corrupt, ffmpeg!));
  const oversized = await raster('png');
  oversized.writeUInt32BE(20000, 16);
  assert.throws(() => normalizedPngSize(oversized));
  await assert.rejects(normalizeBackgroundImage(oversized, ffmpeg!));
});

test('registered background lookup rejects missing assets, mismatched names and hard links', async () => {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'background-paths-'));
  const id = randomUUID(), asset = { id, name: 'Synthetic', src: `background-${id}.png` };
  try {
    await fs.writeFile(path.join(directory, asset.src), await raster('png'));
    assert.equal(await backgroundFile(directory, asset), await fs.realpath(path.join(directory, asset.src)));
    await assert.rejects(backgroundFile(directory, { ...asset, src: '../outside.png' }));
    await assert.rejects(backgroundFile(directory, { ...asset, id: randomUUID() }));
    const link = path.join(directory, 'second-link.png');
    await fs.link(path.join(directory, asset.src), link);
    await assert.rejects(backgroundFile(directory, asset), /独立文件/);
    await fs.unlink(link);
  } finally {
    await fs.unlink(path.join(directory, asset.src)).catch(() => {});
    await fs.rmdir(directory);
  }
});
