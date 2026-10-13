import { useState } from 'react';
import type { Project } from '../../shared/types';
import { selectionDeletion, type EditorSelection } from '../../shared/editor-selection';

/** Timeline clips, inspector zooms and local camera edits share one deletion target. */
export function useEditorSelection(project: Project | null, zoomId: string | null, compositionId: string | null,
  selectZoom: (id: string | null) => void, selectComposition: (id: string | null) => void) {
  const [clip, setClip] = useState<{ projectId: string; id: string } | null>(null);
  const clipId = clip && clip.projectId === project?.id && project?.clips.some(item => item.id === clip.id) ? clip.id : null;
  const validZoom = project?.zooms.some(item => item.id === zoomId) ? zoomId : null;
  const selected: EditorSelection = compositionId ? { kind: 'composition', id: compositionId }
    : validZoom ? { kind: 'zoom', id: validZoom } : clipId ? { kind: 'clip', id: clipId } : null;
  return {
    selected, clipId, zoomId: validZoom, deletion: selectionDeletion(project, selected),
    clip: (id: string | null) => {
      setClip(id && project ? { projectId: project.id, id } : null);
      if (id) { selectZoom(null); selectComposition(null); }
    },
    zoom: (id: string | null) => { if (id) { setClip(null); selectComposition(null); } selectZoom(id); },
    composition: (id: string | null) => { if (id) { setClip(null); selectZoom(null); } selectComposition(id); },
    clear: () => { setClip(null); selectZoom(null); selectComposition(null); },
  };
}
