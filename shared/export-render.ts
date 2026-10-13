import type { Project, StudioApi } from './types';

export interface ExportRenderProgress { progress: number; phase: string }
export type ExportVideoApi = Pick<StudioApi, 'getStatus' | 'exportStart' | 'cancelExportPreparation'
  | 'exportAppend' | 'exportFinish' | 'exportCancel'>;
export interface ExportRendererApi extends ExportVideoApi {
  ready(): Promise<Project>;
  progress(value: ExportRenderProgress): void;
  complete(result: { path: string | null } | { error: string }): void;
  onCancel(callback: () => void): () => void;
}
declare global { interface Window { exportRenderer?: ExportRendererApi } }
