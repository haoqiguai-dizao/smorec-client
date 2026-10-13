import { Scan } from 'lucide-react';
import type { RefObject } from 'react';
import type { CompositionSegment, Project } from '../../shared/types';
import { useCanvasOverlayBounds } from '../hooks/useCanvasOverlayBounds';
import { cameraSelectionState } from '../services/camera-selection';
import { CameraTransformOverlay } from './CameraTransformOverlay';
import '../styles/composition.css';

export function CameraCanvasControls({ project, selectedSegment, sourceTime, canvasRef, onSelect, onPreview, onCommit }: {
  project: Project; selectedSegment?: CompositionSegment; sourceTime: number; canvasRef: RefObject<HTMLCanvasElement | null>;
  onSelect: () => void; onPreview: (id: string, patch: Partial<CompositionSegment> | null) => void;
  onCommit: (id: string, patch: Partial<CompositionSegment>) => void;
}) {
  const bounds = useCanvasOverlayBounds(canvasRef);
  const state = cameraSelectionState(project, sourceTime);
  if (!bounds || !state) return null;
  if (selectedSegment && sourceTime >= selectedSegment.start && sourceTime < selectedSegment.end) {
    return <CameraTransformOverlay project={project} segment={selectedSegment} sourceTime={sourceTime} canvasRef={canvasRef}
      onPreview={patch => onPreview(selectedSegment.id, patch)} onCommit={patch => onCommit(selectedSegment.id, patch)} />;
  }
  const { rect, output } = state;
  return <div className="composition-transform-layer composition-selection-layer" style={bounds}>
    <button type="button" className="composition-camera-select" aria-label="选择画面中的人物" title="选择人物，调整当前局部镜头"
      onClick={onSelect} style={{ left: rect.x / output.width * bounds.width, top: rect.y / output.height * bounds.height,
        width: rect.width / output.width * bounds.width, height: rect.height / output.height * bounds.height,
        borderRadius: `${rect.radius / rect.width * 100}% / ${rect.radius / rect.height * 100}%` }}><Scan size={18} /></button>
  </div>;
}
