import { RotateCcw, Video } from 'lucide-react';
import type { Project } from '../../../shared/types';
import { webcamStyleAt } from '../../../shared/camera-layout';
import { cameraEffectsAt } from '../../../shared/camera-effects';
import { CameraEffectsControls } from '../camera-effects/CameraEffectsControls';
import { Section, Slider, Toggle } from './Controls';
import { updateAppPreferences } from '../../services/app-preferences';
import { CameraShapePicker } from '../camera-shapes/CameraShapePicker';
import { WebcamModeControls } from './WebcamModeControls';
import { PresenterAspectSelect, PresenterCropControls } from '../presenter/PresenterFramingControls';
import type { PresenterAspect } from '../../../shared/presenter';
import { frameContentAt } from '../../../shared/frame-content';
import { CameraEmbeddedNotice } from './CameraEmbeddedNotice';

type CameraStyle = NonNullable<Project['camera']>;
export function WebcamPanel({ project, sourceTime, onChange, onAspectChange }: { project: Project; sourceTime: number; onChange: (camera: CameraStyle) => void;
  onAspectChange?: (aspect: PresenterAspect) => void }) {
  const camera = project.camera;
  if (!camera || !project.media.camera) {
    const hasMode = camera && (camera.mode !== undefined || !!camera.modeKeyframes?.length);
    return <>
      {camera && hasMode && <WebcamModeControls camera={camera} sourceTime={sourceTime}
        onChange={next => onChange({ ...next, enabled: false })} />}
      <div className="webcam-empty"><Video size={29} strokeWidth={1.3} />
        <strong>{hasMode ? '摄像头素材不可用' : '此录制没有摄像头画面'}</strong>
        <span>{hasMode ? '可切回录屏画面继续编辑' : '新建录制时打开摄像头即可'}</span>
      </div>
    </>;
  }
  const content = frameContentAt(project, sourceTime);
  if (content.cameraEmbedded) return <CameraEmbeddedNotice />;
  const effective = webcamStyleAt(camera, sourceTime);
  const effects = cameraEffectsAt(camera, sourceTime);
  const presenter = content.presenter;
  const visible = presenter ? camera.enabled : effective.enabled;
  const update = (patch: Partial<CameraStyle>, manual = false) => onChange({ ...camera,
    ...(manual ? { enabled: visible, shape: effective.shape, mirror: effective.mirror,
      size: effective.size, placement: effective.placement, useRecordedLayout: false } : {}), ...patch });
  const positions = [{ id: 'top-left', label: '左上' }, { id: 'top-right', label: '右上' }, { id: 'bottom-left', label: '左下' }, { id: 'bottom-right', label: '右下' }] as const;
  return <>
    {!content.embeddedInterface && <WebcamModeControls camera={camera} sourceTime={sourceTime} onChange={onChange} />}
    {presenter && <Section title="口播取景" help="画幅应用于整个工程；原始素材保持不变。">
      {onAspectChange && <PresenterAspectSelect value={project.style.aspect} onChange={onAspectChange} />}
      <PresenterCropControls value={camera.presenterCrop} disabled={!visible} onChange={presenterCrop => update({ presenterCrop })} />
    </Section>}
    <Section title="摄像头">
      {!presenter && <Toggle label="显示摄像头" checked={visible} onChange={enabled => update({ enabled }, true)} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}><Toggle label="镜像画面" checked={effective.mirror}
          onChange={mirror => update({ mirror, useRecordedMirror: false })} /></div>
        {!!camera.keyframes?.length && camera.useRecordedMirror === false && <button className="icon-button"
          title="恢复录制时的镜像" aria-label="恢复录制时的镜像" onClick={() => update({ useRecordedMirror: true })}><RotateCcw size={13} /></button>}
      </div>
      {!!camera.keyframes?.length && <Toggle label="使用录制时的布局" checked={camera.useRecordedLayout !== false}
        onChange={useRecordedLayout => update({ useRecordedLayout, ...(useRecordedLayout ? { enabled: true } : {}) }, !useRecordedLayout)} />}
    </Section>
    <div className={visible ? '' : 'disabled'}>
      <section className="inspector-section webcam-effects-section">
        {!!camera.effectKeyframes?.length && <Toggle label="使用录制时的效果" checked={camera.useRecordedEffects !== false} disabled={!visible}
          onChange={useRecordedEffects => onChange({ ...camera, useRecordedEffects, ...(!useRecordedEffects ? { effects } : {}) })} />}
        <CameraEffectsControls value={effects} disabled={!visible}
          onChange={(next, patch) => {
            onChange({ ...camera, effects: next, useRecordedEffects: false });
            updateAppPreferences({ recording: { cameraEffects: patch } });
          }} />
      </section>
      {!presenter && <><Section title="画面形状"><CameraShapePicker value={effective.shape} disabled={!visible} cameraLabels={false}
        onChange={shape => update({ shape }, true)} /></Section>
      <Section title="位置"><div className="webcam-positions">{positions.map(position => <button key={position.id}
        aria-label={position.label} title={position.label} disabled={!visible}
        className={`${position.id} ${!effective.placement && effective.position === position.id ? 'selected' : ''}`}
        onClick={() => update({ position: position.id, placement: undefined }, true)}><i /></button>)}</div></Section></>}
      {!presenter && <Section title="大小与行为">
        <Slider label="画面大小" value={Math.round(effective.size * 100)} min={12} max={42} unit="%" disabled={!visible}
          onChange={size => update({ size: size / 100 }, true)} />
        <Toggle label="镜头放大时缩小" checked={effective.shrinkOnZoom} disabled={!visible}
          onChange={shrinkOnZoom => update({ shrinkOnZoom })} />
      </Section>}
    </div>
  </>;
}
