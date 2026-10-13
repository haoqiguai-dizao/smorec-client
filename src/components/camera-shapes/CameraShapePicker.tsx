import { CAMERA_SHAPE_PRESETS, cameraShapeGeometry, type CameraShape } from '../../../shared/camera-shapes';
import './camera-shapes.css';

export function CameraShapeIcon({ shape }: { shape: CameraShape }) {
  const frame = cameraShapeGeometry(shape, 24, 28, 25);
  return <svg className="camera-shape-icon" width="32" height="28" viewBox="0 0 32 28" aria-hidden="true">
    <rect x={(32 - frame.width) / 2} y={(28 - frame.height) / 2} width={frame.width} height={frame.height}
      rx={frame.radius} fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth="1.4" />
  </svg>;
}
export function CameraShapePicker({ value, disabled, onChange, cameraLabels = true }: {
  value: CameraShape; disabled: boolean; onChange: (value: CameraShape) => void; cameraLabels?: boolean;
}) {
  return <div className="camera-shape-grid" role="group" aria-label="摄像头形状">
    {CAMERA_SHAPE_PRESETS.map(preset => <button key={preset.id} type="button" disabled={disabled}
      aria-label={preset.label + (cameraLabels ? '摄像头' : '')} title={preset.label} aria-pressed={value === preset.id}
      onClick={() => onChange(preset.id)}><CameraShapeIcon shape={preset.id} /><span>{preset.label}</span></button>)}
  </div>;
}
