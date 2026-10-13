import type { TelemetryPreferences } from './telemetry-types';
import type { UpdateSnapshot } from './update-types';
export interface DistributionSnapshot { update: UpdateSnapshot; telemetry: TelemetryPreferences }
export interface DistributionApi {
  state(): Promise<DistributionSnapshot>;
  check(): Promise<void>;
  restart(): Promise<void>;
  openDownload?(): Promise<void>;
  openLicenses?(): Promise<void>;
  setTelemetry(enabled: boolean): Promise<DistributionSnapshot>;
  onChanged(callback: (state: DistributionSnapshot) => void): () => void;
}
declare global { interface Window { distribution?: DistributionApi } }
