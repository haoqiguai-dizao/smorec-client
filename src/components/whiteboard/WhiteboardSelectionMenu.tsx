import { useEffect, useState, type RefObject } from 'react';
import { ArrowRight, Circle, Diamond, Minus, Square, Type } from 'lucide-react';
import { curvePoint, lineCurve } from '../../../shared/whiteboard/geometry';
import type { BoardElement, BoardLine, BoardShape, BoardShapeKind, BoardView } from '../../../shared/whiteboard/types';
import { boardViewport } from '../../services/whiteboard-renderer';

interface Props {
  item: BoardShape | BoardLine;
  items: BoardElement[];
  view?: BoardView;
  canvas: RefObject<HTMLCanvasElement | null>;
  onShape: (shape: BoardShapeKind) => void;
  onArrow: (arrow: boolean) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function WhiteboardSelectionMenu({ item, items, canvas, view: camera, onShape, onArrow }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const measure = () => setSize({ width: target.clientWidth, height: target.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [canvas]);
  if (!size.width || !size.height) return null;
  const view = boardViewport(size.width, size.height, camera);
  const anchor = item.kind === 'shape'
    ? { x: item.x + item.width / 2, y: item.y, bottom: item.y + item.height }
    : { ...curvePoint(lineCurve(item, items), .5), bottom: 0 };
  if (item.kind === 'line') anchor.bottom = anchor.y;
  const halfWidth = item.kind === 'shape' ? 122 : 80;
  const left = clamp(view.left + anchor.x * view.scale, halfWidth + 8, size.width - halfWidth - 8);
  const above = view.top + anchor.y * view.scale - (item.kind === 'shape' ? 72 : 48);
  const top = above >= 8 ? above : Math.min(size.height - 44,
    view.top + anchor.bottom * view.scale + (item.kind === 'shape' ? 38 : 12));
  return <div className="board-selection-menu" role="group"
    aria-label={item.kind === 'shape' ? '更换所选图形的形状' : '更换所选连线的样式'}
    style={{ left, top }}>
    <span>{item.kind === 'shape' ? '换形状' : '改连线'}</span>
    {item.kind === 'shape' ? ([
      ['rectangle', '矩形', Square], ['ellipse', '圆形', Circle], ['diamond', '菱形', Diamond],
      ['text', '纯文字', Type],
    ] as const).map(([shape, label, Icon]) => <button key={shape} type="button" title={label}
      aria-label={`改为${label}`} aria-pressed={item.shape === shape} onClick={() => onShape(shape)}>
      <Icon size={17} strokeWidth={1.8} /></button>) : ([
      [false, '无箭头', Minus], [true, '箭头', ArrowRight],
    ] as const).map(([arrow, label, Icon]) => <button key={label} type="button" title={label}
      aria-label={`改为${label}`} aria-pressed={item.arrow === arrow} onClick={() => onArrow(arrow)}>
      <Icon size={17} strokeWidth={1.8} /></button>)}
  </div>;
}
