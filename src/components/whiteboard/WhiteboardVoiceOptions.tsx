import { Circle, Diamond, Square, Type } from 'lucide-react';
import type { BoardShapeKind } from '../../../shared/whiteboard/types';

export function WhiteboardVoiceOptions({ shape, disabled, onChange }: {
  shape: BoardShapeKind; disabled: boolean; onChange: (shape: BoardShapeKind) => void;
}) {
  return <div className="board-voice-types" role="group" aria-label="语音生成类型">{([
    ['rectangle', '矩形', Square], ['ellipse', '圆形', Circle], ['diamond', '菱形', Diamond], ['text', '纯文字', Type],
  ] as const).map(([value, label, Icon]) => <button key={value} aria-label={`语音生成${label}`}
    title={value === 'text' ? '纯文字 · 支持连线' : label} aria-pressed={shape === value} disabled={disabled}
    onClick={() => onChange(value)}><Icon size={21} /><span>{label}</span></button>)}</div>;
}
