import { ZoomIn } from 'lucide-react';
import { cameraZoom, CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN } from '../../../shared/camera-zoom';
import type { RecordingControlAction } from '../../../shared/types';
import './camera-zoom.css';

export function CameraZoomControl({ value, disabled, control }: {
  value?: number; disabled: boolean; control: (action: RecordingControlAction) => Promise<void>;
}) {
  const zoom = cameraZoom(value);
  return <div className="camera-zoom-control" role="group" aria-label="摄像头变焦" title="上下拖动拉近或拉远画面">
    <ZoomIn size={13} aria-hidden="true" />
    <input type="range" aria-label="摄像头变焦倍数" aria-orientation="vertical" aria-valuetext={`${zoom.toFixed(2)} 倍`}
      min={CAMERA_ZOOM_MIN} max={CAMERA_ZOOM_MAX} step={0.01} value={zoom} disabled={disabled}
      onChange={event => void control({ type: 'camera-zoom', value: Number(event.target.value) })} />
    <button type="button" aria-label="重置摄像头变焦" title="恢复 1×" disabled={disabled || zoom === CAMERA_ZOOM_MIN}
      onClick={() => void control({ type: 'camera-zoom', value: CAMERA_ZOOM_MIN })}>{zoom.toFixed(1)}×</button>
  </div>;
}
