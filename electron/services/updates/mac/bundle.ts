import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { MacReleaseArtifact } from '../../../../shared/update-types';
import { regularPath } from './paths';

const execute = promisify(execFile);
export async function command(file: string, args: string[], signal?: AbortSignal) {
  // Finder launches may have no locale. libarchive otherwise escapes Chinese paths,
  // so validate decoded UTF-8 names without weakening the archive safety checks.
  return execute(file, args, { timeout: 180_000, maxBuffer: 8 * 1024 * 1024, signal,
    env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } });
}
export async function verifyArchive(file: string, artifact: MacReleaseArtifact): Promise<void> {
  await regularPath(file);
  if ((await fs.stat(file)).size !== artifact.size) throw new Error('Mac 更新包大小不符');
  const sha256 = createHash('sha256'), sha512 = createHash('sha512');
  for await (const bytes of createReadStream(file)) { sha256.update(bytes); sha512.update(bytes); }
  if (sha256.digest('hex') !== artifact.sha256 || sha512.digest('base64') !== artifact.sha512) throw new Error('Mac 更新包摘要校验失败');
}
export function validateEntries(listing: string, appName: string): void {
  const entries = listing.trimEnd().split('\n');
  if (!entries.length || entries.length > 50000) throw new Error('Mac 更新包文件数量无效');
  for (const name of entries) {
    const normalized = name.endsWith('/') ? name.slice(0, -1) : name;
    if (normalized !== appName && !normalized.startsWith(appName + '/')) throw new Error('Mac 更新 ZIP 必须只包含当前应用');
    if ((normalized.includes('\\') || [...normalized].some(char => char.charCodeAt(0) < 32)) || normalized.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Mac 更新 ZIP 包含不安全路径');
  }
}
async function auditBundle(root: string): Promise<void> {
  const queue = [root]; let count = 0, bytes = 0;
  while (queue.length) {
    for (const entry of await fs.readdir(queue.pop()!, { withFileTypes: true })) {
      const file = path.join(entry.parentPath, entry.name);
      if (++count > 50000) throw new Error('Mac 应用文件过多');
      if (entry.isSymbolicLink()) {
        const real = await fs.realpath(file), relative = path.relative(root, real);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Mac 应用链接越界');
      } else if (entry.isDirectory()) queue.push(file);
      else if (entry.isFile()) { bytes += (await fs.stat(file)).size; if (bytes > 8 * 1024 ** 3) throw new Error('Mac 应用展开体积过大'); }
      else throw new Error('Mac 应用包含特殊文件');
    }
  }
}
export async function extractBundle(archive: string, destination: string, appName: string): Promise<string> {
  validateEntries((await command('/usr/bin/tar', ['-tf', archive])).stdout, appName);
  await fs.mkdir(destination, { mode: 0o700 });
  // libarchive's default extraction rejects traversal through symlinks; never pass -P.
  await command('/usr/bin/tar', ['-xf', archive, '-C', destination, '--no-same-owner', '--no-same-permissions', '--safe-writes']);
  const bundle = path.join(destination, appName);
  await regularPath(bundle, true); await auditBundle(bundle);
  return bundle;
}
export async function bundleInfo(bundle: string): Promise<{ id: string; version: string; executable: string }> {
  await regularPath(bundle, true);
  const file = path.join(bundle, 'Contents', 'Info.plist'); await regularPath(file);
  const info = JSON.parse((await command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file])).stdout);
  if (info.CFBundleIdentifier !== 'studio.frameflow.desktop' || typeof info.CFBundleShortVersionString !== 'string'
    || typeof info.CFBundleExecutable !== 'string' || (/[/\\]/.test(info.CFBundleExecutable) || [...info.CFBundleExecutable].some(char => char.charCodeAt(0) < 32))
    || !info.CFBundleExecutable || info.CFBundleExecutable.startsWith('.')) throw new Error('Mac 更新应用身份无效');
  await regularPath(path.join(bundle, 'Contents', 'MacOS', info.CFBundleExecutable));
  return { id: info.CFBundleIdentifier, version: info.CFBundleShortVersionString, executable: info.CFBundleExecutable };
}
async function signature(bundle: string): Promise<string> {
  await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  const details = (await command('/usr/bin/codesign', ['-dv', '--verbose=4', bundle])).stderr;
  if (/^Signature=adhoc$/m.test(details)) return 'adhoc';
  const team = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(details)?.[1];
  if (!team) throw new Error('Mac 应用签名无效');
  return team;
}
export async function verifyBundle(candidate: string, target: string, version: string): Promise<void> {
  const next = await bundleInfo(candidate), current = await bundleInfo(target);
  if (next.version !== version || next.executable !== current.executable || next.id !== current.id) throw new Error('Mac 更新版本或应用身份不符');
  const arch = (await command('/usr/bin/lipo', ['-archs', path.join(candidate, 'Contents', 'MacOS', next.executable)])).stdout;
  if (!arch.trim().split(/\s+/).includes('arm64')) throw new Error('Mac 更新包架构不符');
  if (await signature(candidate) !== await signature(target)) throw new Error('Mac 更新签名方式或团队与当前应用不符');
}
