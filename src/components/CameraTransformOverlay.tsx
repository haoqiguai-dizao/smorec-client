import { Move } from 'lucide-react';
import type { RefObject } from 'react';
import type { CompositionSegment, Project } from '../../shared/types';
import { compositionTransformState } from '../services/composition-transform';
import { useCanvasOverlayBounds } from '../hooks/useCanvasOverlayBounds';
import { useCompositionTransform } from '../hooks/useCompositionTransform';
import '../styles/composition.css';

export function CameraTransformOverlay({ project, segment, sourceTime, canvasRef, onPreview, onCommit }: {
  project: Project; segment: CompositionSegment; sourceTime: number; canvasRef: RefObject<HTMLCanvasElement | null>;
  onPreview: (patch: Partial<CompositionSegment> | null) => void; onCommit: (patch: Partial<CompositionSegment>) => void;
}) {
  const bounds = useCanvasOverlayBounds(canvasRef);
  const transform = useCompositionTransform(project, segment, sourceTime, bounds, onPreview, onCommit);
  const state = compositionTransformState(project, transform.draft ? { ...segment, camera: transform.draft } : segment, sourceTime);
  if (!bounds || !state?.editable || !transform.active || !project.media.camera || (segment.camera?.visible ?? state.style.enabled) === false) return null;
  const { rect, output } = state;
  return <div className="composition-transform-layer" style={bounds} aria-label="局部人物画面变换">
    <div className="composition-transform-box" style={{ left: rect.x / output.width * bounds.width, top: rect.y / output.height * bounds.height,
      width: rect.width / output.width * bounds.width, height: rect.height / output.height * bounds.height }}>
      <button type="button" className="composition-transform-drag" aria-label="拖动局部人物位置" title="拖动调整人物位置"
        onPointerDown={event => transform.begin(event, 'move')} onPointerMove={transform.move} onPointerUp={event => transform.end(event)}
        onPointerCancel={event => transform.end(event, true)} onLostPointerCapture={event => transform.end(event, true)}><Move size={15} /></button>
      {(['nw', 'ne', 'se', 'sw'] as const).map(corner => <button key={corner} type="button" className={`composition-transform-handle ${corner}`}
        aria-label={`缩放局部人物 ${corner}`} title="拖动等比调整人物大小" onPointerDown={event => transform.begin(event, corner)}
        onPointerMove={transform.move} onPointerUp={event => transform.end(event)} onPointerCancel={event => transform.end(event, true)}
        onLostPointerCapture={event => transform.end(event, true)} />)}
    </div>
  </div>;
}
