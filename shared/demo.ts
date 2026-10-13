export interface DemoRange { start: number; end: number; camera?: 'independent' }
export interface DemoState {
  enabled: boolean;
  visible: boolean;
  active: boolean;
  ready: boolean;
  busy: boolean;
  desktopHidden: boolean;
  shortcutAvailable: boolean;
  error?: string;
}
export interface DemoApi {
  getState(): Promise<DemoState>;
  menu(): Promise<void>;
  onState(callback: (state: DemoState) => void): () => void;
}
declare global { interface Window { demo?: DemoApi } }

/** Source-time intervals containing the app interface; legacy ranges also contain the camera. */
export function demoCapturedAt(ranges: DemoRange[] | undefined, time: number): boolean {
  return ranges?.some(range => time >= range.start && time < range.end) ?? false;
}
export function demoCameraEmbeddedAt(ranges: DemoRange[] | undefined, time: number): boolean {
  return ranges?.some(range => time >= range.start && time < range.end && range.camera !== 'independent') ?? false;
}
export function parseDemoRanges(value: unknown, duration: number): DemoRange[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('演示录制区间无效');
  let previousEnd = 0;
  return value.map(range => {
    if (!range || typeof range !== 'object' || Array.isArray(range)) throw new Error('演示录制区间无效');
    const { start, end, camera } = range as DemoRange;
    if (![start, end].every(item => typeof item === 'number' && Number.isFinite(item))
      || start < previousEnd || end <= start || end > duration) throw new Error('演示录制区间无效');
    if (camera !== undefined && camera !== 'independent') throw new Error('演示摄像头分层记录无效');
    previousEnd = end;
    return { start, end, ...(camera ? { camera } : {}) };
  });
}
