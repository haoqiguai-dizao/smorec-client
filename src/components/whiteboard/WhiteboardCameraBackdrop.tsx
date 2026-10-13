import { useEffect, useMemo, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import type { BoardSnapshot } from '../../../shared/whiteboard/types';
import { cameraBoardMotion } from '../../../shared/whiteboard/camera-scene';
import { useCameraPreviewReceiver } from '../../hooks/useCameraPreviewReceiver';
import { useCameraEffectPreview } from '../../hooks/useCameraEffectPreview';

export function WhiteboardCameraBackdrop({ state, ready = true }: { state?: Omit<BoardSnapshot, 'events'>; ready?: boolean }) {
  const video = useRef<HTMLVideoElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null), shade = useRef<HTMLDivElement>(null);
  const acknowledged = useRef('');
  const active = state?.backdrop === 'camera' || !!state?.cameraTransition;
  const camera = state?.camera;
  const visible = active && !!state?.visible;
  const preparing = visible && !!state?.opening;
  const preview = useCameraPreviewReceiver(visible && !!camera?.cameraAvailable,
    `${camera?.cameraSessionId}:${state?.session}`, canvas, visible, window.whiteboard?.cameraPreview, preparing);
  const framing = useMemo(() => ({ zoom: camera?.cameraZoom, mirror: camera?.cameraMirror ?? false,
    presenterCrop: camera?.cameraMode === 'presenter' ? camera.cameraPresenter?.crop : undefined }),
    [camera?.cameraZoom, camera?.cameraMirror, camera?.cameraMode, camera?.cameraPresenter?.crop]);
  const error = useCameraEffectPreview(video, canvas, preview.stream, camera?.cameraEffects, visible, framing, stream => {
    if (stream === preview.stream && ready && state?.opening && acknowledged.current !== state.opening) {
      acknowledged.current = state.opening;
      const opening = state.opening;
      void window.whiteboard?.viewReady?.(state.session, opening).catch(() => {
        if (acknowledged.current === opening) acknowledged.current = '';
      });
    }
  }, preparing);
  useEffect(() => {
    const target = video.current;
    if (!target) return;
    target.srcObject = preview.stream;
    if (preview.stream) void target.play().catch(() => {});
    return () => { target.pause(); target.srcObject = null; };
  }, [preview.stream]);
  useEffect(() => {
    let animation = 0;
    const paint = () => {
      const elapsed = state?.cameraTransition ? Date.now() / 1000 - state.cameraTransition.startedAt : Infinity;
      const motion = cameraBoardMotion(state ?? {}, elapsed), start = state?.cameraTransition?.camera ?? { x: .7, y: .7, width: .25, height: .25 };
      if (frame.current) Object.assign(frame.current.style, {
        left: (start.x * (1 - motion.camera) * 100) + '%', top: (start.y * (1 - motion.camera) * 100) + '%',
        width: ((start.width + (1 - start.width) * motion.camera) * 100) + '%',
        height: ((start.height + (1 - start.height) * motion.camera) * 100) + '%',
        borderRadius: (12 * (1 - motion.camera)) + 'px',
      });
      if (shade.current) shade.current.style.opacity = String(motion.shade);
      document.documentElement.style.setProperty('--board-camera-ink', String(motion.ink));
      if (!motion.finished) animation = requestAnimationFrame(paint);
    };
    if (active) paint();
    return () => { cancelAnimationFrame(animation); document.documentElement.style.removeProperty('--board-camera-ink'); };
  }, [active, state?.cameraTransition, state?.shade]);
  const warning = preview.error ?? error;
  return <div className="board-camera-backdrop" aria-hidden="true" style={{ visibility: active ? 'visible' : 'hidden' }}>
    <div className="board-camera-frame" ref={frame}>
      <video ref={video} autoPlay playsInline muted style={{ opacity: 0, position: 'absolute' }} />
      <canvas ref={canvas} />
      {(!preview.stream || warning || !camera?.cameraAvailable) && <span className="board-camera-warning">
        <AlertCircle size={18} />{warning ?? (!camera?.cameraAvailable ? '摄像头已断开，笔迹仍保留' : '摄像头正在连接')}
      </span>}
      <div className="board-camera-shade" ref={shade} />
    </div>
  </div>;
}
