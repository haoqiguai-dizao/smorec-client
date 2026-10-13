import path from 'node:path';
import type { MacReleaseArtifact, ReleaseArtifact, ReleasePayload } from '../../shared/update-types';

export type PlatformArtifact = ReleaseArtifact | MacReleaseArtifact;
export interface ReleaseFiles { artifact?: string; 'app-update'?: string; 'mac-artifact'?: string; 'mac-app-update'?: string }
export function releaseFiles(values: ReleaseFiles, version: string): { file: string; platform: 'win32' | 'darwin' }[] {
  const files: { file: string; platform: 'win32' | 'darwin' }[] = [];
  const add = (file: string, suffix: string, platform: 'win32' | 'darwin') => {
    if (!file.endsWith(suffix)) throw new Error(`请选择本版本的 ${suffix} 制品`);
    files.push({ file: path.resolve(file), platform });
  };
  if (values.artifact) {
    add(values.artifact, `-Setup-${version}.exe`, 'win32');
    add(values['app-update'] ?? `release-v${version}/小录-${version}-app-update.zip`, `-${version}-app-update.zip`, 'win32');
  } else if (values['app-update']) throw new Error('Windows 更新包必须与安装包配对');
  if (values['mac-artifact']) {
    add(values['mac-artifact'], `-${version}-mac-arm64.dmg`, 'darwin');
    add(values['mac-app-update'] ?? `release-v${version}/小录-${version}-mac-arm64.zip`, `-${version}-mac-arm64.zip`, 'darwin');
  } else if (values['mac-app-update']) throw new Error('Mac 更新包必须与 DMG 安装包配对');
  if (!files.length) throw new Error('请提供 Windows 安装包或 Mac DMG 安装包');
  return files;
}
export function allReleaseArtifacts(payload: ReleasePayload): PlatformArtifact[] {
  return [...payload.artifacts, ...(payload.appUpdate ? [payload.appUpdate] : []), ...(payload.macArtifacts ?? [])];
}
export function artifactFields(artifacts: PlatformArtifact[]): Pick<ReleasePayload, 'artifacts' | 'appUpdate' | 'macArtifacts'> {
  const windows = artifacts.filter((artifact): artifact is ReleaseArtifact => artifact.platform === 'win32');
  const mac = artifacts.filter((artifact): artifact is MacReleaseArtifact => artifact.platform === 'darwin');
  const appUpdate = windows.find(artifact => artifact.name.endsWith('.zip'));
  return { artifacts: windows.filter(artifact => artifact.name.endsWith('.exe')), ...(appUpdate ? { appUpdate } : {}),
    ...(mac.length ? { macArtifacts: mac } : {}) };
}
export function matchesArtifacts(saved: PlatformArtifact[], next: PlatformArtifact[], urls = false): boolean {
  return saved.length === next.length && next.every(item => saved.some(old => old.platform === item.platform && old.arch === item.arch
    && old.name === item.name && old.size === item.size && old.sha256 === item.sha256 && old.sha512 === item.sha512 && (!urls || old.url === item.url)));
}
