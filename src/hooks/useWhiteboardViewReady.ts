import { useEffect } from 'react';
import type { BoardSnapshot } from '../../shared/whiteboard/types';

/** Confirm committed React content without depending on a hidden window's RAF. */
export function useWhiteboardViewReady(ready: boolean, state?: Omit<BoardSnapshot, 'events'>): void {
  useEffect(() => {
    const api = window.whiteboard;
    if (!ready || !state?.opening || state.backdrop === 'camera' || !api?.viewReady) return;
    const { session, opening } = state;
    const timer = window.setTimeout(() => { void api.viewReady!(session, opening).catch(() => {}); }, 0);
    return () => window.clearTimeout(timer);
  }, [ready, state?.session, state?.opening, state?.backdrop]);
}
