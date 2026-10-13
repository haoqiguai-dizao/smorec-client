import { cameraZoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX } from '../../../shared/camera-zoom';
import { Camera, EyeOff, Image, ImagePlus, Monitor, Scissors, Trash2, X } from 'lucide-react';
import type { CompositionSegment, Project } from '../../../shared/types';
import { BACKGROUNDS } from '../../../shared/constants';
import { compositionCameraMaxSize } from '../../../shared/composition-camera';
import { compositionTransformState } from '../../services/composition-transform';
import { compositionPresetPatch } from '../../services/composition-presets';
import type { CompositionEditingProps } from '../composition-types';
import { CameraShapePicker } from '../camera-shapes/CameraShapePicker';
import { CompositionSlider } from './CompositionSlider';
import { CompositionNumberField } from './CompositionNumberField';
import { CompositionPresetPicker } from './CompositionPresetPicker';
import { Section, Toggle } from './Controls';
import '../../styles/composition.css';
import { CameraEmbeddedNotice } from './CameraEmbeddedNotice';

export function CompositionPanel({ project, segment, sourceTime, ...editing }: CompositionEditingProps & {
  project: Project; segment: CompositionSegment; sourceTime: number;
}) {
  const state = compositionTransformState(project, segment, sourceTime);
  const segments = [...project.compositions ?? []].sort((a, b) => a.start - b.start), index = segments.findIndex(item => item.id === segment.id);
  const min = segments[index - 1]?.end ?? 0, max = segments[index + 1]?.start ?? project.duration, frame = 1 / project.fps;
  const change = (patch: Partial<CompositionSegment>) => editing.onUpdateComposition?.(segment.id, patch);
  const camera = (patch: NonNullable<CompositionSegment['camera']>) => change({ camera: { ...segment.camera, ...patch } });
  const visible = segment.camera?.visible ?? state?.style.enabled ?? false;
  const shape = segment.camera?.shape ?? state?.style.shape ?? 'circle';
  return <div className="composition-panel" aria-label="局部镜头属性">
    <header><Camera size={15} /><strong>局部镜头 {index + 1}</strong><button type="button" aria-label="取消局部镜头选择" title="返回全局属性"
      onClick={() => editing.onSelectComposition?.(null)}><X size={15} /></button></header>
    <Section title="时间范围">
      <div className="composition-number-grid">
        <CompositionNumberField label="局部镜头开始" value={segment.start} min={min} max={segment.end - frame} unit="秒" onCommit={start => change({ start })} />
        <CompositionNumberField label="局部镜头结束" value={segment.end} min={segment.start + frame} max={max} unit="秒" onCommit={end => change({ end })} />
      </div>
      <div className="composition-segment-actions"><button type="button" title="在播放位置分割局部镜头" aria-label="分割局部镜头"
        disabled={sourceTime - segment.start < frame || segment.end - sourceTime < frame}
        onClick={() => editing.onSplitComposition?.(segment.id, sourceTime)}><Scissors size={14} /></button>
        <button type="button" aria-label="删除局部镜头" title="删除局部镜头" onClick={() => editing.onDeleteComposition?.(segment.id)}><Trash2 size={14} /></button></div>
    </Section>
    {state && !state.editable && <CameraEmbeddedNotice local />}
    {state?.editable && <Section title="人物">
      <CompositionPresetPicker disabled={!project.media.camera || !editing.onUpdateComposition} onSelect={preset => {
        const patch = compositionPresetPatch(project, segment, sourceTime, preset);
        if (patch) change(patch);
      }} />
      <Toggle label="显示人物" checked={visible} onChange={visible => camera({ visible })} />
      <Toggle label="镜像画面" checked={segment.camera?.mirror ?? state.style.mirror}
        onChange={mirror => camera({ mirror })} />
      <div className={visible ? '' : 'composition-disabled'}>
        <CompositionSlider key={segment.id} label="人物大小" value={state.rect.width / Math.min(state.output.width, state.output.height) * 100}
          min={8} max={Math.floor(compositionCameraMaxSize(shape, state.output.width, state.output.height) * 100)} disabled={!visible}
          onPreview={value => editing.onPreviewComposition?.(segment.id, value === null ? null : { camera: { ...segment.camera, size: value / 100 } })}
          onCommit={value => camera({ size: value / 100 })} />
        <CompositionSlider key={`${segment.id}-zoom`} label="人物变焦" value={cameraZoom(segment.camera?.zoom ?? state.style.zoom) * 100}
          min={CAMERA_ZOOM_MIN * 100} max={CAMERA_ZOOM_MAX * 100} disabled={!visible} formatValue={value => `${(value / 100).toFixed(2)}×`}
          onPreview={value => editing.onPreviewComposition?.(segment.id, value === null ? null : { camera: { ...segment.camera, zoom: value / 100 } })}
          onCommit={value => camera({ zoom: value / 100 })} />
        <div className="composition-number-grid">
          <CompositionNumberField label="人物 X 位置" value={state.rect.x / state.output.width * 100} min={0}
            max={(1 - state.rect.width / state.output.width) * 100} unit="%" onCommit={value => camera({ x: value / 100 })} />
          <CompositionNumberField label="人物 Y 位置" value={state.rect.y / state.output.height * 100} min={0}
            max={(1 - state.rect.height / state.output.height) * 100} unit="%" onCommit={value => camera({ y: value / 100 })} />
        </div>
        <CameraShapePicker value={shape} disabled={!visible} cameraLabels={false} onChange={shape => camera({ shape })} />
      </div>
    </Section>}
    <Section title="桌面画面">
      <div className="composition-screen-modes" role="group" aria-label="局部桌面画面">
        {([{ id: 'recording', name: '录屏', Icon: Monitor }, { id: 'hidden', name: '隐藏', Icon: EyeOff },
          { id: 'background', name: '替换', Icon: Image }] as const).map(({ id, name, Icon }) => <button key={id} type="button"
          aria-pressed={segment.screen === id} aria-label={`局部桌面${name}`} title={name}
          onClick={() => change({ screen: id, ...(id === 'background' && !segment.background ? { background: project.style.background } : {}) })}><Icon size={16} /><span>{name}</span></button>)}
      </div>
      {segment.screen === 'background' && <div className="composition-backgrounds">
        <div className="composition-background-grid" role="group" aria-label="局部背景">
          {BACKGROUNDS.map(background => <button key={background.id} type="button" title={background.name} aria-label={`局部背景${background.name}`}
            aria-pressed={segment.background === background.id} style={{ background: `linear-gradient(135deg, ${background.colors.join(',')})` }}
            onClick={() => change({ background: background.id })} />)}
          {editing.compositionBackgrounds?.map(background => <button key={background.id} type="button" title={background.name} aria-label={background.name}
            aria-pressed={segment.background === background.id} onClick={() => change({ background: background.id })}>
            {background.url ? <img src={background.url} alt="" /> : <Image size={17} />}</button>)}
        </div>
        {editing.onChooseCompositionBackground && <button className="composition-import-background" type="button" onClick={() => void editing.onChooseCompositionBackground?.(segment.id)}><ImagePlus size={14} />选择图片</button>}
      </div>}
    </Section>
  </div>;
}
