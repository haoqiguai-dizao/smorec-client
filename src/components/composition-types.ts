import type { CompositionSegment } from '../../shared/types';

export interface CompositionEditingProps {
  selectedCompositionId?: string | null;
  onSelectComposition?: (id: string | null) => void;
  onAddComposition?: () => void;
  onUpdateComposition?: (id: string, patch: Partial<CompositionSegment>) => void;
  onPreviewComposition?: (id: string, patch: Partial<CompositionSegment> | null) => void;
  onDeleteComposition?: (id: string) => void;
  onSplitComposition?: (id: string, sourceTime: number) => void;
  onChooseCompositionBackground?: (id: string) => void | Promise<void>;
  compositionBackgrounds?: { id: string; name: string; url?: string }[];
}
