export interface ToolbarRegion { x: number; y: number; width: number; height: number }
export interface ToolbarPresentationApi {
  /** Null restores the regular native window; regions limit painting and pointer hit testing. */
  setRegions(regions: ToolbarRegion[] | null): Promise<void>;
  quit?(): Promise<boolean>;
}
declare global { interface Window { toolbarPresentation?: ToolbarPresentationApi } }
