const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { verifyMacSignedBinary } = require('./mach-o-release.cjs');
const validFFmpegConfiguration = value => /ffmpeg version 6\.1\.1\b/.test(value) && !/--enable-nonfree\b/.test(value) && ['gpl', 'libdav1d', 'libvpx', 'libwebp', 'libx264'].every(name => new RegExp('--enable-' + name + '\\b').test(value));

const runtimeFiles = ['libsherpa-onnx-c-api.dylib', 'libonnxruntime.1.23.2.dylib', 'NOTICE.txt', 'LICENSE-APACHE-2.0.txt', 'ONNXRUNTIME-THIRD-PARTY-NOTICES.txt', 'PUBLIC-RUNTIME.json'];
const ffmpegFiles = ['ffmpeg', 'SOURCE-BUILD.json', 'LICENSE.GPLv3', 'LICENSE.libwebp', 'LICENSE.dav1d', 'LICENSE.libvpx', 'PATENTS.libvpx', 'ffmpeg-corresponding-source.tar.gz', 'README.txt'];
const legalSources = [
  ['docs/open-source/public/THIRD-PARTY-LICENSES.txt', 'npm-licenses.txt'],
  ['docs/open-source/public/NATIVE-SPEECH-NOTICES.txt', 'native-speech-notices.txt'],
  ['native/THIRD-PARTY-NOTICES.txt', 'native-notices.txt'],
  ['node_modules/electron/dist/LICENSE', 'LICENSE.electron.txt'],
  ['node_modules/electron/dist/LICENSES.chromium.html', 'LICENSES.chromium.html'],
];
const hash = value => createHash('sha256').update(value).digest('hex');
function verifyMacReleaseInputs(root, config, run = execFileSync) {
  const read = name => fs.readFileSync(path.join(root, name));
  const nonempty = name => { const bytes = read(name); if (!bytes.length) throw new Error('Empty Mac redistribution material: ' + name); return bytes; };
  const same = (actual, expected, name) => { if (!actual.equals(expected)) throw new Error('Mac redistribution material differs: ' + name); };
  const vendor = 'native/macos/Vendor/SherpaOnnx';
  for (const name of runtimeFiles) nonempty(vendor + '/' + name);
  const receipt = JSON.parse(read(vendor + '/PUBLIC-RUNTIME.json'));
  if (receipt.tts !== false || receipt.sherpaVersion !== '1.12.29' || !receipt.source.endsWith('-shared-no-tts.tar.bz2')) throw new Error('Mac speech runtime must use the recorded official NO-TTS release');
  for (const name of runtimeFiles.slice(0, 2)) {
    const entry = receipt.files.find(value => value.file === name), bytes = read(vendor + '/' + name);
    if (!entry || bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error('Mac speech runtime receipt mismatch: ' + name);
    if (String(run('/usr/bin/lipo', ['-archs', path.join(root, vendor, name)])).trim() !== 'arm64') throw new Error('Mac speech runtime must be arm64: ' + name);
  }
  if (/\b_espeak_(?:ng_)?\w+/.test(String(run('/usr/bin/nm', ['-g', path.join(root, vendor, runtimeFiles[0])], { maxBuffer: 16 * 1024 * 1024 })))) throw new Error('Mac NO-TTS runtime contains an eSpeak engine');
  const resources = config.extraResources;
  const generated = resources.find(value => value.from === 'native/macos/.build/release/speech' && value.to === 'native/speech');
  const tracked = resources.find(value => value.from === vendor && value.to === 'native/speech');
  if (JSON.stringify(generated?.filter) !== JSON.stringify(['XiaoLu.Speech']) || JSON.stringify(tracked?.filter?.slice().sort()) !== JSON.stringify(runtimeFiles.slice().sort())) throw new Error('Mac speech inputs must exclude stale generated libraries and include all tracked runtime materials');
  nonempty('native/macos/.build/release/speech/XiaoLu.Speech');
  function checkLegal(sources) {
    for (const [source, name] of sources) {
      const location = source.startsWith('docs/open-source/public/') && !fs.existsSync(path.join(root, source))
        ? path.basename(source) : source;
      same(nonempty('output/release-legal/' + name), nonempty(location), name);
    }
    const version = JSON.parse(read('package.json')).version;
    const expected = Buffer.from(read('build/mac-legal-README.txt').toString().replaceAll('{{VERSION}}', version));
    same(nonempty('output/release-legal/README.txt'), expected, 'README.txt');
  }
  const legalSourcesForRoot = legalSources.slice();
  if (fs.existsSync(path.join(root, 'LICENSE'))) legalSourcesForRoot.push(['LICENSE', 'LICENSE.client.txt']);
  // Beauty notices join the same tracked/locked notice comparison.
  for (const name of fs.readdirSync(path.join(root, 'public/beauty'))) if (name.endsWith('.txt')) legalSourcesForRoot.push(['public/beauty/' + name, name]);
  checkLegal(legalSourcesForRoot);
  for (const name of ffmpegFiles) nonempty('output/ffmpeg-gpl/' + name);
  const ff = JSON.parse(read('output/ffmpeg-gpl/SOURCE-BUILD.json'));
  if (hash(read('output/ffmpeg-gpl/ffmpeg')) !== ff.sha256) throw new Error('Mac FFmpeg binary source receipt mismatch');
  if (!validFFmpegConfiguration(String(run(path.join(root, 'output/ffmpeg-gpl/ffmpeg'), ['-version'])))) throw new Error('Mac FFmpeg redistribution configuration mismatch');
  if (ff.license !== 'GPL-3.0-or-later' || ff.sources.length !== 5) throw new Error('Mac FFmpeg needs the complete five-source GPL receipt');
  const archive = path.join(root, 'output/ffmpeg-gpl/ffmpeg-corresponding-source.tar.gz');
  const tar = args => Buffer.from(run('/usr/bin/tar', args, { maxBuffer: 64 * 1024 * 1024 }));
  const entries = tar(['-tzf', archive]).toString().trim().split('\n');
  const allowed = ['SOURCE-BUILD.json', 'sources/', 'sources/BUILD.md', 'sources/build-gpl-ffmpeg.py', ...ff.sources.map(value => 'sources/' + value.name)];
  if (JSON.stringify(entries.slice().sort()) !== JSON.stringify(allowed.sort())) throw new Error('Unexpected content in FFmpeg corresponding source');
  for (const entry of ff.sources) if (hash(tar(['-xOf', archive, 'sources/' + entry.name])) !== entry.sha256) throw new Error('FFmpeg corresponding source mismatch: ' + entry.name);
  same(tar(['-xOf', archive, 'sources/build-gpl-ffmpeg.py']), nonempty('scripts/open-source/build-gpl-ffmpeg.py'), 'FFmpeg standalone recipe');
  return { runtimeFiles: runtimeFiles.length, legalFiles: legalSourcesForRoot.length + 1, sourceArchives: ff.sources.length };
}
function verifyMacPackagedMaterials(root, resources, run = execFileSync) {
  verifyMacReleaseInputs(root, require(path.join(root, 'build/mac.cjs')), run);
  const read = file => fs.readFileSync(file);
  const same = (source, shipped) => { if (!read(source).equals(read(shipped))) throw new Error('Packaged Mac material differs: ' + shipped); };
  const exactFiles = (folder, names) => {
    if (JSON.stringify(fs.readdirSync(folder).sort()) !== JSON.stringify(names.slice().sort())) throw new Error('Packaged Mac material list differs: ' + folder);
  };
  const speech = path.join(resources, 'native/speech');
  exactFiles(speech, ['XiaoLu.Speech', ...runtimeFiles]);
  for (const name of runtimeFiles) {
    const source = path.join(root, 'native/macos/Vendor/SherpaOnnx', name), shipped = path.join(speech, name);
    if (name.endsWith('.dylib')) {
      verifyMacSignedBinary(source, shipped, run);
    } else same(source, shipped);
  }
  verifyMacSignedBinary(path.join(root, 'native/macos/.build/release/speech/XiaoLu.Speech'), path.join(speech, 'XiaoLu.Speech'), run);
  const legal = path.join(resources, 'legal'), inputLegal = path.join(root, 'output/release-legal');
  exactFiles(legal, fs.readdirSync(inputLegal));
  for (const name of fs.readdirSync(inputLegal)) same(path.join(inputLegal, name), path.join(legal, name));
  const ffmpeg = path.join(resources, 'ffmpeg'); exactFiles(ffmpeg, ffmpegFiles);
  const ffmpegBinary = path.join(ffmpeg, 'ffmpeg');
  const ffmpegContentSha256 = verifyMacSignedBinary(path.join(root, 'output/ffmpeg-gpl/ffmpeg'), ffmpegBinary, run);
  if (!validFFmpegConfiguration(String(run(ffmpegBinary, ['-version'])))) throw new Error('Packaged Mac FFmpeg redistribution configuration mismatch');
  for (const name of ffmpegFiles.filter(value => value !== 'ffmpeg')) same(path.join(root, 'output/ffmpeg-gpl', name), path.join(ffmpeg, name));
  return { ffmpegContentSha256, speechRuntimeFiles: runtimeFiles.length + 1, legalFiles: fs.readdirSync(legal).length, ffmpegFiles: ffmpegFiles.length };
}
if (require.main === module) console.log(JSON.stringify(verifyMacReleaseInputs(process.cwd(), require(path.join(process.cwd(), 'build/mac.cjs')))));
module.exports = { verifyMacReleaseInputs, verifyMacPackagedMaterials };
