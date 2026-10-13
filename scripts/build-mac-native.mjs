import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('native/macos');
const cache = path.join(root, '.build', 'cache');
mkdirSync(cache, { recursive: true });
execFileSync('swift', ['build', '--disable-sandbox', '--package-path', root,
  '-c', 'release', '-debug-info-format', 'none'], {
  stdio: 'inherit', env: { ...process.env, XDG_CACHE_HOME: cache,
    CLANG_MODULE_CACHE_PATH: path.join(cache, 'clang'), SWIFT_MODULE_CACHE_PATH: path.join(cache, 'swift') },
});
const vendor = path.join(root, 'Vendor/SherpaOnnx');
const output = path.join(root, '.build/release/speech');
mkdirSync(output, { recursive: true });
const executable = path.join(output, 'XiaoLu.Speech');
execFileSync('clang', ['-arch', 'arm64', '-O2', '-Wall', '-Wextra',
  '-I', vendor, path.join(root, 'Sources/XiaoLuSpeech/main.c'), '-L', vendor,
  '-lsherpa-onnx-c-api', '-Wl,-rpath,@executable_path', '-o', executable], { stdio: 'inherit' });
for (const name of ['libsherpa-onnx-c-api.dylib', 'libonnxruntime.1.23.2.dylib']) {
  copyFileSync(path.join(vendor, name), path.join(output, name));
}
for (const name of ['NOTICE.txt', 'LICENSE-APACHE-2.0.txt', 'ONNXRUNTIME-THIRD-PARTY-NOTICES.txt']) {
  copyFileSync(path.join(vendor, name), path.join(output, name));
}
if (existsSync(path.join(vendor, 'PUBLIC-RUNTIME.json'))) copyFileSync(path.join(vendor, 'PUBLIC-RUNTIME.json'), path.join(output, 'PUBLIC-RUNTIME.json'));
