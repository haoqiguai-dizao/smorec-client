import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CompositionCamera, CompositionSegment, Project } from '../../shared/types';
import { compositionTransformState, transformCompositionCamera, type CompositionTransformMode, type CompositionTransformStart } from '../services/composition-transform';

interface Gesture extends CompositionTransformStart { pointerId: number; target: HTMLElement; camera: CompositionCamera; latest?: CompositionCamera }
export function useCompositionTransform(project: Project, segment: CompositionSegment, sourceTime: number,
  viewport: { width: number; height: number } | undefined,
  onPreview: (patch: Partial<CompositionSegment> | null) => void, onCommit: (patch: Partial<CompositionSegment>) => void) {
  const gesture = useRef<Gesture | undefined>(undefined);
  const callbacks = useRef({ onPreview, onCommit }); callbacks.current = { onPreview, onCommit };
  const [draft, setDraft] = useState<CompositionCamera>();
  const active = sourceTime >= segment.start && sourceTime < segment.end
    && !!compositionTransformState(project, segment, sourceTime)?.editable;
  function cancel() {
    const current = gesture.current; gesture.current = undefined;
    if (!current) return;
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    setDraft(undefined); callbacks.current.onPreview(null);
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); cancel(); } };
    window.addEventListener('blur', cancel); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape); cancel(); };
  }, [segment.id, active]);
  function begin(event: ReactPointerEvent<HTMLElement>, mode: CompositionTransformMode) {
    if (!active || !viewport || event.button !== 0 || gesture.current) return;
    const state = compositionTransformState(project, segment, sourceTime); if (!state) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { mode, rect: state.rect, output: state.output, viewport, clientX: event.clientX, clientY: event.clientY,
      pointerId: event.pointerId, target: event.currentTarget, camera: { ...segment.camera } };
  }
  function move(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (!current.latest && Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) < .5) return;
    const next = { ...current.camera, ...transformCompositionCamera(current, event.clientX, event.clientY) };
    current.latest = next; setDraft(next); callbacks.current.onPreview({ camera: next });
  }
  function end(event: ReactPointerEvent<HTMLElement>, cancelled = false) {
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
    if (cancelled) { cancel(); return; }
    move(event); gesture.current = undefined;
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    setDraft(undefined); callbacks.current.onPreview(null);
    if (current.latest) callbacks.current.onCommit({ camera: current.latest });
  }
  return { active, draft, begin, move, end };
}
