import type { LiveRecordingState, RecordingControlAction } from '../../../shared/types';
import { useCameraResize } from '../../hooks/useCameraResize';
import { CAMERA_SIZE_MAX, CAMERA_SIZE_MIN } from '../../services/camera-resize';
import { cameraResizeContour } from '../../services/camera-resize-contour';
import './camera-resize.css';

export function CameraResizeHandles({ state, enabled, control }: {
  state: LiveRecordingState; enabled: boolean; control: (action: RecordingControlAction) => Promise<void>;
}) {
  const resize = useCameraResize(state, enabled, control);
  if (!resize.allowed) return null;
  const contour = cameraResizeContour(state.cameraShape, Math.max(1, ((state.cameraViewport ?? state.cameraPanel?.camera)?.width ?? 112) - 12));
  return <div className={`camera-resize-handles ${resize.dragging ? 'resizing' : ''}`}>
    {contour.segments.map(({ edge, label, path, bounds }) => <div key={edge} className="camera-resize-segment"
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}>
    <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}>
    <path role="button" tabIndex={0} className={`camera-resize-handle ${edge}`} d={path}
      vectorEffect="non-scaling-stroke" aria-label={`调整摄像头大小：${label}`} onPointerDown={event => resize.begin(event, edge)}
      onPointerMove={resize.move} onPointerUp={resize.end} onPointerCancel={resize.cancel} onLostPointerCapture={resize.cancel}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const size = event.key === 'Home' ? CAMERA_SIZE_MIN : event.key === 'End' ? CAMERA_SIZE_MAX
          : state.cameraSize + (['ArrowRight', 'ArrowUp'].includes(event.key) ? .01 : -.01);
        void control({ type: 'camera-size', value: Math.max(CAMERA_SIZE_MIN, Math.min(CAMERA_SIZE_MAX, Math.round(size * 100) / 100)) });
      }}><title>拖动边缘调整大小</title></path></svg></div>)}
  </div>;
}
