export const MAC_PERMISSIONS = ['screen', 'camera', 'microphone', 'input', 'accessibility'] as const;
export type MacPermission = typeof MAC_PERMISSIONS[number];
export type PermissionAccess = 'granted' | 'not-determined' | 'denied' | 'restricted' | 'not-granted' | 'unknown';
export interface PermissionStatus { kind: MacPermission; granted: boolean; access?: PermissionAccess }
export interface MacCameraStatus { availableCount: number; suspendedCount: number; builtInSuspended: boolean }
export type PermissionComponentId = 'application' | 'capture';
export interface PermissionComponent { id: PermissionComponentId; name: string; role: string; granted?: boolean }
export interface PlatformPermissionsApi {
  get(): Promise<PermissionStatus[]>;
  request(kind: MacPermission, component?: PermissionComponentId): Promise<void>;
  openSettings?(kind: MacPermission): Promise<void>;
  cameraStatus?(): Promise<MacCameraStatus>;
  components?(kind: MacPermission): Promise<PermissionComponent[]>;
  dragComponent?(kind: MacPermission, id: PermissionComponentId): void;
  revealComponent?(kind: MacPermission, id: PermissionComponentId): Promise<void>;
  onComponentError?(callback: (message: string) => void): () => void;
}
declare global { interface Window { platformPermissions?: PlatformPermissionsApi } }
