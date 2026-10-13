import { useCallback, useRef, useState } from 'react';
import type { Project } from '../../shared/types';

export function useCanvasBackgroundEditor(project: Project | null, change: (patch: Partial<Project>) => void,
  onError: (message: string) => void) {
  const current = useRef(project);
  const pending = useRef(false);
  const [importing, setImporting] = useState(false);
  current.current = project;
  const choose = useCallback(async () => {
    const active = current.current;
    if (!active || pending.current) return;
    if (!window.studio) { onError('请从桌面版上传背景图片'); return; }
    pending.current = true; setImporting(true);
    try {
      const asset = await window.studio.importBackground(active.id);
      const latest = current.current;
      if (!asset || latest?.id !== active.id) return;
      change({ backgrounds: [...(latest.backgrounds ?? []).filter(item => item.id !== asset.id), asset],
        style: { ...latest.style, background: `asset:${asset.id}` } });
    } catch (error) { onError(error instanceof Error ? error.message : '背景图片上传失败'); }
    finally { pending.current = false; setImporting(false); }
  }, [change, onError]);
  return { choose, importing };
}
