import { ArrowRight, Circle, ClipboardPaste, Diamond, Minus, Square, Trash2 } from 'lucide-react';
import { BOARD_COLORS } from '../../../shared/whiteboard/types';
import { CAMERA_BOARD_COLORS } from '../../../shared/whiteboard/camera-scene';
import type { BoardTool } from './WhiteboardTools';
import type { BoardShapeKind } from '../../../shared/whiteboard/types';
import { WhiteboardVoiceOptions } from './WhiteboardVoiceOptions';

export type BoardPanel = 'stroke' | 'colors' | 'shape' | 'voice' | 'more';
interface ColorProps { camera?: boolean; color: string; disabled: boolean; onColor: (color: string) => void }
export function ColorChoices(p: ColorProps) {
  const names = p.camera ? ['白色', '黄色', '红色', '蓝色', '绿色'] : ['黑色', '红色', '蓝色', '绿色', '紫色'];
  return <div className="board-colors" role="group" aria-label="笔迹颜色">{(p.camera ? CAMERA_BOARD_COLORS : BOARD_COLORS).map((color, index) => <button key={color}
    aria-label={names[index]} title={names[index]}
    aria-pressed={p.color === color} disabled={p.disabled} onClick={() => p.onColor(color)}><i style={{ backgroundColor: color }} /></button>)}</div>;
}
interface Props extends ColorProps {
  panel: BoardPanel; tool: BoardTool; size: number; eraserDiameter: number;
  voiceShape: BoardShapeKind; onVoiceShape: (shape: BoardShapeKind) => void;
  onSize: (size: number) => void; onEraserDiameter: (size: number) => void;
  onShape: (tool: BoardTool) => void; onClear: () => void; onPasteImage: () => void;
}
export function WhiteboardToolOptions(p: Props) {
  if (p.panel === 'voice') return <WhiteboardVoiceOptions shape={p.voiceShape} disabled={p.disabled} onChange={p.onVoiceShape} />;
  if (p.panel === 'more') return <>
    <button className="board-more-row" disabled={p.disabled} onClick={p.onPasteImage}>
      <ClipboardPaste size={17} /><span>粘贴截图</span><small>⌘V</small></button>
    <button className="board-more-row board-clear" disabled={p.disabled} onClick={p.onClear}>
      <Trash2 size={17} /><span>清空白板</span><small>可撤销</small></button>
  </>;
  if (p.panel === 'colors') return <ColorChoices {...p} />;
  if (p.panel === 'shape') return <><div className="board-shapes" role="group" aria-label="形状与连线">{([
    ['rectangle', '矩形', Square], ['ellipse', '圆形', Circle], ['diamond', '判断菱形', Diamond],
    ['line', '无箭头连线', Minus], ['arrow', '箭头连线', ArrowRight],
  ] as const).map(([tool, label, Icon]) => <button key={tool} aria-label={label}
    title={tool === 'ellipse' ? '点击放置正圆，拖动可画椭圆' : label}
    aria-pressed={p.tool === tool} disabled={p.disabled} onClick={() => p.onShape(tool)}>
    <Icon size={21} strokeWidth={1.8} /><span>{label}</span>
  </button>)}</div><div className="board-shape-width" role="group" aria-label="图形线条粗细">{[3, 6, 12].map(size => <button
    key={size} title={`${size} 像素`} aria-label={`${size} 像素线条`} aria-pressed={p.size === size}
    onClick={() => p.onSize(size)} disabled={p.disabled}><i style={{ height: Math.max(2, size / 3), backgroundColor: p.color }} /></button>)}</div></>;
  const erasing = p.tool === 'eraser', choices = erasing ? [28, 48, 72] : [3, 6, 12];
  return <>
    <div className="board-options-label">{erasing ? '橡皮范围' : '线条粗细'}</div>
    <div className="board-sizes" role="group" aria-label={erasing ? '橡皮范围' : '线条粗细'}>{choices.map((size, index) => <button key={size}
      title={['小', '中', '大'][index]} aria-label={`${['小', '中', '大'][index]}${erasing ? '橡皮' : '线条'}`}
      aria-pressed={(erasing ? p.eraserDiameter : p.size) === size}
      disabled={p.disabled} onClick={() => erasing ? p.onEraserDiameter(size) : p.onSize(size)}>
      <i style={{ width: erasing ? 10 + index * 6 : size + 2, height: erasing ? 10 + index * 6 : size + 2,
        backgroundColor: erasing ? '#8e9299' : p.color }} />
    </button>)}</div>
  </>;
}
