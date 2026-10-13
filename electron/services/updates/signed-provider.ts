import { Provider, type ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import type { UpdateInfo } from 'builder-util-runtime';
import type { AppUpdater } from 'electron-updater';
import type { SignedRelease } from '../../../shared/update-types';
import { releaseArtifact, macReleaseArtifact } from './manifest';

/** A fixed, already verified release. The stock updater never reads an unsigned remote feed. */
export function signedProvider(release: SignedRelease, platform: 'win32' | 'darwin' = 'win32') {
  const artifact = platform === 'darwin' ? macReleaseArtifact(release) : releaseArtifact(release);
  return class SignedProvider extends Provider<UpdateInfo> {
    constructor(_configuration: unknown, _updater: AppUpdater, runtime: ProviderRuntimeOptions) { super(runtime); }
    async getLatestVersion(): Promise<UpdateInfo> {
      return { version: release.payload.version, releaseDate: release.payload.publishedAt,
        releaseNotes: release.payload.releaseNotes, path: artifact.url, sha512: artifact.sha512,
        files: [{ url: artifact.url, size: artifact.size, sha512: artifact.sha512 }] };
    }
    resolveFiles(info: UpdateInfo) {
      if (info.version !== release.payload.version) throw new Error('更新版本与签名不一致');
      return [{ url: new URL(artifact.url), info: { url: artifact.url, size: artifact.size, sha512: artifact.sha512 } }];
    }
  };
}
