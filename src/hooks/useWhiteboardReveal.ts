import { useEffect, type RefObject } from 'react';
import type { BoardScene } from '../../shared/whiteboard/model';
import { boardHasReveal } from '../../shared/whiteboard/motion';

/** Keep the live canvas moving only while an entrance is active; no idle frame loop. */
export function useWhiteboardReveal(scene: BoardScene, enabled: boolean, paint: RefObject<() => void>): void {
  useEffect(() => {
    if (!enabled || !boardHasReveal(scene.items, scene.reveals, performance.now() / 1000)) return;
    let frame = 0, previous = -Infinity;
    const tick = (now: number) => {
      const active = boardHasReveal(scene.items, scene.reveals, now / 1000);
      if (!active || now - previous >= 1000 / 30) { paint.current(); previous = now; }
      if (active) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [scene, enabled, paint]);
}
