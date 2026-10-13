import type { MacPermission, PermissionComponentId } from './platform-permissions';

export interface PermissionGuideContext {
  kind: MacPermission;
  needs: MacPermission[];
  mode: 'record' | 'live';
  inputDisabled: boolean;
  startup?: boolean;
  component?: PermissionComponentId;
}
export type PermissionGuideAction = 'close' | 'complete' | 'skip-input' | 'enable-input' | 'disable-camera' | 'disable-microphone';
export type PermissionGuideHelpAction = 'settings' | 'refresh' | 'reveal';
export interface PermissionGuideApi {
  show(context: PermissionGuideContext): Promise<void>;
  dismiss(): Promise<void>;
  context(): Promise<PermissionGuideContext | null>;
  action(action: PermissionGuideAction): Promise<void>;
  step(kind: MacPermission): Promise<void>;
  help(): Promise<void>;
  onContext(callback: (context: PermissionGuideContext) => void): () => void;
  onAction(callback: (action: PermissionGuideAction) => void): () => void;
  onHelpAction(callback: (action: PermissionGuideHelpAction) => void): () => void;
}
declare global { interface Window { permissionGuide?: PermissionGuideApi } }
