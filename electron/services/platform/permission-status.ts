import { systemPreferences } from 'electron';
import { MAC_PERMISSIONS, type PermissionAccess, type PermissionStatus } from '../../../shared/platform-permissions';
import type { NativeClient } from '../native-client';

export interface NativePermissions {
  screenPermission: boolean; microphonePermission: boolean; microphoneAuthorization?: PermissionAccess;
  inputPermission: boolean; accessibilityPermission: boolean;
}
export async function readPlatformPermissions(native: NativeClient): Promise<PermissionStatus[]> {
  const value = await native.request<NativePermissions>('capabilities');
  return MAC_PERMISSIONS.map(kind => {
    const granted = kind === 'input' ? value.inputPermission : kind === 'accessibility' ? value.accessibilityPermission
      : kind === 'screen' ? value.screenPermission && systemPreferences.getMediaAccessStatus('screen') === 'granted'
        : kind === 'microphone' ? value.microphonePermission : systemPreferences.getMediaAccessStatus(kind) === 'granted';
    const access: PermissionAccess = granted ? 'granted' : kind === 'microphone' ? value.microphoneAuthorization ?? 'not-granted'
      : kind === 'camera' ? systemPreferences.getMediaAccessStatus(kind) : 'not-granted';
    return { kind, granted, access };
  });
}
