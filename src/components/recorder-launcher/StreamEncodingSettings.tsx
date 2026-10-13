import type { StreamProfilesModel } from '../../hooks/useStreamProfiles';
export function StreamEncodingSettings({ model: m, disabled }: { model: StreamProfilesModel; disabled: boolean }) {
  return <div className="launcher-stream-encoding">
    <label>画质<select aria-label="推流画质" disabled={disabled} value={m.draft.resolution} onChange={event => m.change({ resolution: event.target.value as '720p' | '1080p' })}><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
    <label>帧率<select aria-label="推流帧率" disabled={disabled} value={m.draft.fps} onChange={event => m.change({ fps: Number(event.target.value) as 30 | 60 })}><option value={30}>30 FPS</option><option value={60}>60 FPS</option></select></label>
    <label>码率 kbps<input aria-label="推流码率" type="number" min={500} max={20000} step={500} disabled={disabled} value={m.draft.bitrate} onChange={event => m.change({ bitrate: Number(event.target.value) })} /></label>
    <label>关键帧 秒<input aria-label="推流关键帧间隔" type="number" min={1} max={10} disabled={disabled} value={m.draft.keyframeSeconds} onChange={event => m.change({ keyframeSeconds: Number(event.target.value) })} /></label>
  </div>;
}
