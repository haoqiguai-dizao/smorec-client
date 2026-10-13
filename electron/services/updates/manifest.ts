import { createPublicKey, verify } from 'node:crypto';
import { compare, valid } from 'semver';
import type { SignedRelease, UpdateConfiguration, ReleaseArtifact, MacReleaseArtifact } from '../../../shared/update-types';

export function compareVersions(left: string, right: string): number {
  for (const value of [left, right]) {
    if (typeof value !== 'string' || value.length > 64 || !/^\d+\.\d+\.\d+/.test(value)
      || value.trim() !== value || !valid(value)) throw new Error('版本号无效');
  }
  return compare(left, right);
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  throw new Error('更新清单格式无效');
}
export function secureUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('更新地址必须使用 HTTPS');
  return url;
}
export function parseRelease(value: unknown, config: UpdateConfiguration, platform: 'win32' | 'darwin' = 'win32'): SignedRelease {
  if (!value || typeof value !== 'object') throw new Error('更新清单无效');
  const release = value as SignedRelease, payload = release.payload;
  if (release.schema !== 1 || typeof release.keyId !== 'string' || !Object.hasOwn(config.publicKeys, release.keyId)
    || typeof release.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(release.signature)
    || !payload || payload.product !== 'smorec' || payload.channel !== config.channel) throw new Error('更新来源不受信任');
  compareVersions(payload.version, payload.version);
  if (!Number.isFinite(Date.parse(payload.publishedAt)) || typeof payload.releaseNotes !== 'string'
    || payload.releaseNotes.length > 8000 || !Array.isArray(payload.artifacts) || payload.artifacts.length > 1 || (platform === 'win32' && payload.artifacts.length !== 1)) throw new Error('更新清单格式无效');
  for (const artifact of payload.artifacts) {
  if (artifact.platform !== 'win32' || artifact.arch !== 'x64' || !Number.isSafeInteger(artifact.size)
    || artifact.size < 1 || artifact.size > 2 * 1024 ** 3 || typeof artifact.name !== 'string'
    || !/^[^\\/<>:"|?*]{1,160}\.exe$/i.test(artifact.name) || [...artifact.name].some(char => char.charCodeAt(0) < 32)
    || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !/^[A-Za-z0-9+/]{86}==$/.test(artifact.sha512)) throw new Error('更新文件格式无效');
  secureUrl(artifact.url);
  }
  if (payload.macArtifacts !== undefined) validateMacArtifacts(payload.macArtifacts);
  if (platform === 'darwin') macReleaseArtifact(release);
  if (payload.appUpdate !== undefined) validateAppUpdate(payload.appUpdate);
  const key = createPublicKey(config.publicKeys[release.keyId]);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(canonicalJson(payload)), key, Buffer.from(release.signature, 'base64'))) {
    throw new Error('更新签名校验失败');
  }
  return release;
}
export function releaseArtifact(release: SignedRelease): ReleaseArtifact { return release.payload.artifacts[0]; }

function validateAppUpdate(artifact: ReleaseArtifact): void {
  if (!artifact || artifact.platform !== 'win32' || artifact.arch !== 'x64'
    || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 2 * 1024 ** 3
    || typeof artifact.name !== 'string' || !/^[^\\/<>:"|?*]{1,160}\.zip$/i.test(artifact.name)
    || [...artifact.name].some(character => character.charCodeAt(0) < 32)
    || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !/^[A-Za-z0-9+/]{86}==$/.test(artifact.sha512)) {
    throw new Error('应用更新包格式无效');
  }
  secureUrl(artifact.url);
}

export function macReleaseArtifact(release: SignedRelease): MacReleaseArtifact {
  const artifact = release.payload.macArtifacts?.find(item => item.arch === 'arm64' && item.name.endsWith('.zip'));
  if (!artifact) throw new Error('此版本没有适用于当前 Mac 的更新包');
  return artifact;
}

function validateMacArtifacts(artifacts: MacReleaseArtifact[]): void {
  if (!Array.isArray(artifacts) || artifacts.length !== 2) throw new Error('Mac 安装包和更新包必须成对提供');
  const extensions = new Set<string>();
  for (const artifact of artifacts) {
    if (!artifact || artifact.platform !== 'darwin' || artifact.arch !== 'arm64'
      || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 2 * 1024 ** 3
      || typeof artifact.name !== 'string' || !/^[^\\/<>:"|?*]{1,160}\.(zip|dmg)$/.test(artifact.name)
      || [...artifact.name].some(char => char.charCodeAt(0) < 32)
      || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !/^[A-Za-z0-9+/]{86}==$/.test(artifact.sha512)) throw new Error('Mac 更新文件格式无效');
    secureUrl(artifact.url);
    extensions.add(artifact.name.slice(-3));
  }
  if (extensions.size !== 2) throw new Error('Mac 更新文件重复');
}
