import { useCallback, useEffect, useRef } from 'react';
import type { Project } from '../../shared/types';
import { CompositionBackgroundCache } from '../services/composition-backgrounds';

export function useCompositionBackground(projectId: string | undefined, draw: () => void, onError: (message: string) => void) {
  const cache = useRef<CompositionBackgroundCache | null>(null);
  const requested = useRef(new Set<string>());
  const callbacks = useRef({ draw, onError });
  callbacks.current = { draw, onError };
  useEffect(() => {
    const current = new CompositionBackgroundCache();
    cache.current = current; requested.current.clear();
    callbacks.current.draw();
    return () => { current.dispose(); if (cache.current === current) cache.current = null; };
  }, [projectId]);

  return useCallback((project: Project, time: number) => {
    const current = cache.current;
    if (!current) return;
    const key = current.key(project, time);
    const image = current.peek(project, time);
    if (key && !image && !requested.current.has(key)) {
      requested.current.add(key);
      void current.prepare(project, time).then(() => {
        if (cache.current !== current) return;
        requested.current.delete(key); callbacks.current.draw();
      }).catch(error => {
        if (cache.current === current) callbacks.current.onError(error instanceof Error ? error.message : '背景图片无法读取');
      });
    }
    return image;
  }, []);
}
