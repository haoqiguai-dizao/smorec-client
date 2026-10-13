import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const { verifyMacReleaseInputs } = createRequire(import.meta.url)('../scripts/mac-release-inputs.cjs');
const vendor = 'native/macos/Vendor/SherpaOnnx';
const libs = ['libsherpa-onnx-c-api.dylib', 'libonnxruntime.1.23.2.dylib'];
const materials = [...libs, 'NOTICE.txt', 'LICENSE-APACHE-2.0.txt', 'ONNXRUNTIME-THIRD-PARTY-NOTICES.txt', 'PUBLIC-RUNTIME.json'];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-release-inputs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (name: string, data: string) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), data); };
  for (const name of materials) await write(vendor + '/' + name, name);
  await write(vendor + '/PUBLIC-RUNTIME.json', JSON.stringify({ tts: false, sherpaVersion: '1.12.29', source: 'official-shared-no-tts.tar.bz2', files: libs.map(file => ({ file, bytes: Buffer.byteLength(file), sha256: digest(file) })) }));
  await write('native/macos/.build/release/speech/XiaoLu.Speech', 'executable');
  await write('package.json', JSON.stringify({ version: '0.9.118' }));
  await write('build/mac-legal-README.txt', 'version={{VERSION}}');
  const legal = [ ['docs/open-source/public/THIRD-PARTY-LICENSES.txt', 'npm-licenses.txt'], ['docs/open-source/public/NATIVE-SPEECH-NOTICES.txt', 'native-speech-notices.txt'], ['native/THIRD-PARTY-NOTICES.txt', 'native-notices.txt'], ['node_modules/electron/dist/LICENSE', 'LICENSE.electron.txt'], ['node_modules/electron/dist/LICENSES.chromium.html', 'LICENSES.chromium.html'], ['public/beauty/LICENSE.txt', 'LICENSE.txt'] ];
  for (const [source, name] of legal) { await write(source, name); await write('output/release-legal/' + name, name); }
  await write('output/release-legal/README.txt', 'version=0.9.118');
  const ffFiles = ['ffmpeg', 'LICENSE.GPLv3', 'LICENSE.libwebp', 'LICENSE.dav1d', 'LICENSE.libvpx', 'PATENTS.libvpx', 'ffmpeg-corresponding-source.tar.gz', 'README.txt'];
  for (const name of ffFiles) await write('output/ffmpeg-gpl/' + name, name);
  const sources = ['ffmpeg', 'x264', 'webp', 'dav1d', 'vpx'].map(name => ({ name: name + '.tar.gz', sha256: digest(name) }));
  await write('output/ffmpeg-gpl/SOURCE-BUILD.json', JSON.stringify({ license: 'GPL-3.0-or-later', sha256: digest('ffmpeg'), sources }));
  await write('scripts/open-source/build-gpl-ffmpeg.py', 'standalone recipe');
  const entries = ['SOURCE-BUILD.json', 'sources/', 'sources/BUILD.md', 'sources/build-gpl-ffmpeg.py', ...sources.map(value => 'sources/' + value.name)];
  const payload = new Map(sources.map(value => ['sources/' + value.name, value.name.split('.')[0]])); payload.set('sources/build-gpl-ffmpeg.py', 'standalone recipe');
  const run = (command: string, args: string[]) => args[0] === '-version' ? 'ffmpeg version 6.1.1 --enable-gpl --enable-libdav1d --enable-libvpx --enable-libwebp --enable-libx264' : command.endsWith('/lipo') ? 'arm64' : command.endsWith('/nm') ? 'NO-TTS symbols' : args[0] === '-tzf' ? entries.join('\n') : payload.get(args[2])!;
  const config = { extraResources: [{ from: 'native/macos/.build/release/speech', to: 'native/speech', filter: ['XiaoLu.Speech'] }, { from: vendor, to: 'native/speech', filter: materials }] };
  return { root, write, run, config, payload, entries };
}
test('release input gate accepts complete runtime, notices, current README and corresponding source', async t => {
  const f = await fixture(t); assert.deepEqual(verifyMacReleaseInputs(f.root, f.config, f.run), { runtimeFiles: 6, legalFiles: 7, sourceArchives: 5 });
});
test('public client uses root notices after internal document directories are excluded', async t => {
  const f = await fixture(t);
  for (const name of ['THIRD-PARTY-LICENSES.txt', 'NATIVE-SPEECH-NOTICES.txt']) {
    await fs.rename(path.join(f.root, 'docs/open-source/public', name), path.join(f.root, name));
  }
  assert.deepEqual(verifyMacReleaseInputs(f.root, f.config, f.run), { runtimeFiles: 6, legalFiles: 7, sourceArchives: 5 });
});
test('public client license must be preserved exactly in the Mac redistribution materials', async t => {
  const f = await fixture(t);
  await f.write('LICENSE', 'client GPL license');
  assert.throws(() => verifyMacReleaseInputs(f.root, f.config, f.run), /ENOENT/);
  await f.write('output/release-legal/LICENSE.client.txt', 'different license');
  assert.throws(() => verifyMacReleaseInputs(f.root, f.config, f.run), /material differs: LICENSE.client/);
  await f.write('output/release-legal/LICENSE.client.txt', 'client GPL license');
  assert.deepEqual(verifyMacReleaseInputs(f.root, f.config, f.run), { runtimeFiles: 6, legalFiles: 8, sourceArchives: 5 });
});
test('release input gate rejects a missing ONNX notice before packaging', async t => {
  const f = await fixture(t); await fs.unlink(path.join(f.root, vendor, 'ONNXRUNTIME-THIRD-PARTY-NOTICES.txt'));
  assert.throws(() => verifyMacReleaseInputs(f.root, f.config, f.run), /ENOENT/);
});
test('release input gate rejects an older library against the NO-TTS receipt', async t => {
  const f = await fixture(t); await f.write(vendor + '/' + libs[0], 'old library');
  assert.throws(() => verifyMacReleaseInputs(f.root, f.config, f.run), /runtime receipt mismatch/);
});
test('release input gate rejects reusing all stale generated speech resources', async t => {
  const f = await fixture(t); f.config.extraResources[0].filter = ['**/*'];
  assert.throws(() => verifyMacReleaseInputs(f.root, f.config, f.run), /stale generated libraries/);
});
test('release input gate rejects a previous-version legal README', async t => {
  const f = await fixture(t); await f.write('output/release-legal/README.txt', 'version=0.9.117');
  assert.throws(() => verifyMacReleaseInputs(f.root, f.config, f.run), /material differs: README/);
});
test('release input gate rejects changed corresponding-source bytes', async t => {
  const f = await fixture(t); f.payload.set('sources/ffmpeg.tar.gz', 'wrong archive');
  assert.throws(() => verifyMacReleaseInputs(f.root, f.config, f.run), /corresponding source mismatch/);
});
test('release input gate rejects private application source even inside sources directory', async t => {
  const f = await fixture(t); f.entries.push('sources/src/App.tsx');
  assert.throws(() => verifyMacReleaseInputs(f.root, f.config, f.run), /Unexpected content/);
});

test('release input gate rejects raw FFmpeg mutation against the full source receipt', async t => {
  const f = await fixture(t); await f.write('output/ffmpeg-gpl/ffmpeg', 'changed executable');
  assert.throws(() => verifyMacReleaseInputs(f.root, f.config, f.run), /FFmpeg binary source receipt mismatch/);
});
test('release input gate rejects nonfree FFmpeg even with a matching raw receipt', async t => {
  const f = await fixture(t);
  const run = (command: string, args: string[]) => args[0] === '-version' ? f.run(command, args) + ' --enable-nonfree' : f.run(command, args);
  assert.throws(() => verifyMacReleaseInputs(f.root, f.config, run), /redistribution configuration mismatch/);
});
