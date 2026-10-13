import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { LiveRecordingState, RecordingControlAction } from '../../shared/types';
import { CameraSizeDispatcher, cameraResizeSize, type CameraResizeEdge, type CameraResizeStart } from '../services/camera-resize';

interface Gesture extends CameraResizeStart { pointerId: number; target: Element; last: number }
export function useCameraResize(state: LiveRecordingState | undefined, enabled: boolean,
  control: (action: RecordingControlAction) => Promise<void>) {
  const gesture = useRef<Gesture | undefined>(undefined);
  const dispatcher = useRef<CameraSizeDispatcher | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const allowed = enabled && !!state?.cameraAvailable && !!state.cameraVisible && state.cameraMode !== 'presenter'
    && state.countdown === undefined && !['starting', 'stopping'].includes(state.status);
  function finish() {
    const active = gesture.current; gesture.current = undefined;
    if (active?.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
    setDragging(false);
  }
  useEffect(() => {
    if (!allowed) { finish(); return; }
    const send = new CameraSizeDispatcher(size => control({ type: 'camera-size', value: size }));
    dispatcher.current = send;
    return () => { send.stop(); dispatcher.current = undefined; finish(); };
  }, [allowed, control, state?.cameraShape, state?.cameraSessionId, state?.status]);
  useEffect(() => {
    const cancel = () => { dispatcher.current?.discardPending(); finish(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); cancel(); } };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape); finish(); };
  }, []);
  function begin(event: ReactPointerEvent<Element>, edge: CameraResizeEdge) {
    if (!allowed || !state || event.button !== 0 || gesture.current) return;
    const camera = state.cameraViewport ?? state.cameraPanel?.camera;
    if (!camera) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { edge, pointerId: event.pointerId, target: event.currentTarget,
      screenX: event.screenX, screenY: event.screenY, width: camera.width, height: camera.height,
      size: state.cameraSize, last: state.cameraSize };
    setDragging(true);
  }
  function move(event: ReactPointerEvent<Element>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const size = cameraResizeSize(active, event.screenX, event.screenY);
    if (size !== active.last) { active.last = size; dispatcher.current?.update(size); }
  }
  function end(event: ReactPointerEvent<Element>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    move(event); finish();
  }
  function cancel(event: ReactPointerEvent<Element>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    dispatcher.current?.discardPending(); finish();
  }
  return { allowed, dragging, begin, move, end, cancel };
}
