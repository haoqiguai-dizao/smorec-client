import { Maximize2, PictureInPicture2, ScanFace, UserRound } from 'lucide-react';
import type { CompositionPreset } from '../../services/composition-presets';
import '../camera-shapes/camera-shapes.css';
import './composition-presets.css';

const presets = [
  { id: 'bottom-right', label: '右下小窗', Icon: PictureInPicture2 },
  { id: 'reaction', label: '放大反应', Icon: Maximize2 },
  { id: 'centered', label: '人物居中', Icon: ScanFace },
  { id: 'person-only', label: '只留人物', Icon: UserRound },
] as const;

export function CompositionPresetPicker({ disabled, onSelect }: {
  disabled: boolean; onSelect: (preset: CompositionPreset) => void;
}) {
  return <div className="camera-shape-grid composition-preset-grid" role="group" aria-label="局部构图预设">
    {presets.map(({ id, label, Icon }) => <button key={id} type="button" disabled={disabled}
      aria-label={`局部构图${label}`} title={label} onClick={() => onSelect(id)}><Icon size={16} /><span>{label}</span></button>)}
  </div>;
}
