import { useEffect, useRef, type RefObject } from 'react';

/** Keep keyboard navigation inside a modal and return focus to its opening control. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, dismiss: () => void, returnFocusSelector?: string) {
  const dismissRef = useRef(dismiss); dismissRef.current = dismiss;
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
      .filter(element => element.getClientRects().length > 0);
    (focusable()[0] ?? panel).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissRef.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      // The originating action can be disabled before the dialog mounts. Restore
      // after its busy state clears, using the explicit action when supplied.
      requestAnimationFrame(() => {
        const target = (returnFocusSelector ? document.querySelector<HTMLElement>(returnFocusSelector) : null) ?? previous;
        if (target?.isConnected) target.focus();
      });
    };
  }, [ref, returnFocusSelector]);
}
