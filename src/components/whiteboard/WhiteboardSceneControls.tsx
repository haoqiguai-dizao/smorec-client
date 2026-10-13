import { Camera, ChevronDown, Presentation } from 'lucide-react';
import { useState } from 'react';
import type { BoardBackdrop, BoardPresentation } from '../../../shared/whiteboard/types';

export function WhiteboardSceneControls({ backdrop = 'white', shade = .4, disabled, returnDisabled, cameraAvailable, onChange, presentation, onChoose }: {
  backdrop?: BoardBackdrop; shade?: number; disabled: boolean; cameraAvailable: boolean;
  returnDisabled: boolean;
  onChange(value: BoardBackdrop, shade?: number): void;
  presentation?: BoardPresentation; onChoose?(): void;
}) {
  const [open, setOpen] = useState(false);
  const camera = backdrop === 'camera';
  return <div className="board-scene-controls">
    <button className="board-scene-toggle" aria-label={onChoose ? '切换白板模式' : camera ? '返回普通白板' : '摄像头白板'}
      title={onChoose ? '切换白板模式，保留本次内容' : cameraAvailable ? '摄像头铺满，蒙版渐入后书写' : '先开启并连接摄像头'}
      disabled={onChoose ? disabled : camera ? returnDisabled : disabled || !cameraAvailable} aria-pressed={camera}
      aria-haspopup={onChoose ? 'menu' : undefined}
      onClick={() => { setOpen(false); if (onChoose) onChoose(); else onChange(camera ? 'white' : 'camera'); }}>
      {camera ? <Camera size={15} /> : <Presentation size={15} />}<span>{onChoose ? camera ? '摄像头界面' : presentation === 'interface' ? '完整界面' : '纯画布' : camera ? '普通白板' : '摄像头白板'}</span>
      {onChoose && <ChevronDown size={12} />}
    </button>
    {camera && <button aria-label="调整黑色蒙版" title="调整蒙版深浅" aria-expanded={open}
      disabled={disabled} onClick={() => setOpen(!open)}><ChevronDown size={12} /></button>}
    {camera && open && <div className="board-shade-options" role="dialog" aria-label="摄像头白板蒙版">
      <label>蒙版<output>{Math.round(shade * 100)}%</output></label>
      <input aria-label="黑色蒙版深浅" type="range" min={15} max={75} step={5} value={Math.round(shade * 100)}
        disabled={disabled} onChange={event => onChange('camera', Number(event.target.value) / 100)} />
    </div>}
  </div>;
}
