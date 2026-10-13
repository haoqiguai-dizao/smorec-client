import { cameraZoom } from '../../../shared/camera-zoom';
import { DEFAULT_PRESENTER } from '../../../shared/presenter';
import { CameraZoomControl } from './CameraZoomControl';
import { AlertCircle, GripHorizontal, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCameraPreviewReceiver } from '../../hooks/useCameraPreviewReceiver';
import { useRecordingOverlay } from '../../hooks/useRecordingOverlay';
import { CameraControls } from './CameraControls';
import { useCameraEffectPreview } from '../../hooks/useCameraEffectPreview';
import { cameraShapeGeometry } from '../../../shared/camera-shapes';
import { useTeleprompter } from '../../hooks/useTeleprompter';
import { Teleprompter } from './Teleprompter';
import { useCameraSettings } from '../../hooks/useCameraSettings';
import { CameraSettingsPanel } from './CameraSettingsPanel';
import { ORIGINAL_CAMERA_EFFECTS } from '../../../shared/camera-effects';
import { CameraResizeHandles } from './CameraResizeHandles';

export function CameraOverlay() {
  const { state, error, active, control } = useRecordingOverlay();
  const presenter = state?.cameraMode === 'presenter';
  const teleprompter = useTeleprompter(state);
  const settings = useCameraSettings(state);
  const [comparing, setComparing] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useCameraPreviewReceiver(!!state?.cameraAvailable &&
    (!!state.cameraPreviewing || ['starting', 'recording', 'stopping'].includes(state.status)), state?.cameraSessionId, canvas, !!state?.cameraVisible);
  const effectError = useCameraEffectPreview(video, canvas, preview.stream, comparing && settings.open ? ORIGINAL_CAMERA_EFFECTS : state?.cameraEffects,
    !!state?.cameraVisible && !!state?.cameraAvailable && (!!state.cameraPreviewing || ['starting', 'recording', 'stopping'].includes(state.status)));
  const [playbackError, setPlaybackError] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let active = true;
    setPlaybackError(false);
    element.srcObject = preview.stream;
    if (preview.stream) void element.play().catch(() => { if (active) setPlaybackError(true); });
    return () => { active = false; element.pause(); element.srcObject = null; };
  }, [preview.stream]);
  const previewError = preview.error ?? effectError ?? (playbackError ? '预览暂不可用' : undefined);
  const frame = cameraShapeGeometry(state?.cameraShape ?? 'circle', 100);
  const borderRadius = presenter ? '8px' : `${frame.radius}% / ${frame.radius / frame.height * 100}%`;
  const cameraBounds = state?.cameraPanel?.camera;
  const viewport = state?.cameraViewport ?? cameraBounds;
  const toggleTeleprompter = () => {
    if (settings.open) { void settings.setOpen(false); teleprompter.show(); }
    else teleprompter.toggle();
  };
  const warning = error ?? settings.error;
  const zoom = cameraZoom(state?.cameraZoom);
  const crop = presenter ? state?.cameraPresenter?.crop ?? DEFAULT_PRESENTER.crop : DEFAULT_PRESENTER.crop;
  const position = `${crop.x * 100}% ${crop.y * 100}%`;
  return <main className={`camera-overlay-window ${presenter ? 'presenter' : ''}`} aria-label="摄像头浮窗">
    <div className={`camera-overlay-content ${viewport ? 'has-layout' : ''}`} style={viewport
      ? { left: cameraBounds?.x ?? 0, top: cameraBounds?.y ?? 0, width: viewport.width, height: viewport.height } : undefined}>
    <div className={`overlay-camera-frame ${presenter ? 'presenter' : state?.cameraShape ?? 'circle'}`} style={{ borderRadius }} title="拖动调整摄像头位置">
      <video ref={video} autoPlay muted playsInline aria-label="录制中摄像头预览" style={{ position: 'absolute', opacity: 0 }} />
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', transform: state?.cameraMirror ? 'scaleX(-1)' : undefined }}>
        <canvas ref={canvas} aria-label="录制中摄像头效果" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: position,
          pointerEvents: 'none', transform: `scale(${zoom})`, transformOrigin: position }} />
      </div>
      {(!preview.stream || previewError) && <div className="overlay-preview-status">{previewError ? <><AlertCircle size={22} /><span>{previewError}</span><button className="overlay-reconnect" onClick={preview.reconnect}><RefreshCw size={13} />重新连接</button></> : <><LoaderCircle className="spinning" size={22} /><span>正在连接</span></>}</div>}
      <span className="overlay-camera-grip"><GripHorizontal size={21} /></span>
      {warning && <span className="overlay-camera-error" role="alert" title={warning}><AlertCircle size={16} /></span>}
    </div>
    {state?.cameraAvailable && !teleprompter.visible && <CameraZoomControl value={state.cameraZoom}
      disabled={!active || settings.busy || !!state.countdown || !preview.stream || !!previewError} control={control} />}
    <Teleprompter controller={teleprompter} />
    {state && <CameraControls state={state} disabled={!active} control={control} compact
      teleprompterOpen={teleprompter.visible} onTeleprompterToggle={toggleTeleprompter}
      settingsBusy={settings.busy} onSettingsToggle={() => void settings.setOpen(!settings.open)} />}
    {state && <CameraResizeHandles state={state} enabled={active && !settings.busy} control={control} />}
    </div>
    {state && <CameraSettingsPanel state={state} disabled={!active || settings.busy} control={control}
      onCompare={setComparing} onClose={() => void settings.setOpen(false)} />}
  </main>;
}
