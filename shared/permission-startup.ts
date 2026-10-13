export interface PermissionStartupApi {
  enter(): Promise<void>;
  quit(): Promise<void>;
}
declare global { interface Window { permissionStartup?: PermissionStartupApi } }
