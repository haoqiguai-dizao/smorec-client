import { useEffect, useRef, type PointerEvent } from 'react';

const interactive = 'button, summary, input, select, textarea, label, a, video, [role="button"], [role="slider"], [contenteditable="true"], [tabindex], [data-no-drag]';

/** DOM dragging leaves wheel/scrollbar events intact; native app-region would swallow them. */
export function useLauncherPanelDrag() {
  const active = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const send = (action: 'start' | 'move' | 'end') => { void window.recorder?.dragWindow(action).catch(() => {}); };
  const end = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    if (active.current !== undefined) send('end');
    active.current = undefined;
  };
  useEffect(() => {
    const stop = () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      if (active.current !== undefined) void window.recorder?.dragWindow('end').catch(() => {});
      active.current = undefined;
    };
    window.addEventListener('blur', stop);
    return () => { window.removeEventListener('blur', stop); stop(); };
  }, []);
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !event.isPrimary || !window.recorder?.dragWindow || !(event.target instanceof Element)
        || event.target.closest(interactive)) return;
      // Leave native scrollbars available, even when their pointer target is the scroll container.
      const scroll = event.target.closest('.launcher-panel-content');
      if (scroll instanceof HTMLElement) {
        const rect = scroll.getBoundingClientRect();
        if (event.clientX >= rect.left + scroll.clientLeft + scroll.clientWidth
          || event.clientY >= rect.top + scroll.clientTop + scroll.clientHeight) return;
      }
      active.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault(); send('start');
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (active.current !== event.pointerId || frame.current !== undefined) return;
      frame.current = requestAnimationFrame(() => { frame.current = undefined; send('move'); });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (active.current !== event.pointerId) return;
      send('move'); end();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: end,
    onLostPointerCapture: end,
  };
}
