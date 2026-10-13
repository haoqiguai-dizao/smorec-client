import { useEffect } from 'react';

interface KeyboardActions { save: () => void; undo: () => void; redo?: () => void; play: () => void; split: () => void;
  remove?: () => void; deselect?: () => void; step?: (direction: number, seconds: boolean) => void; enabled: boolean }
export function useKeyboard(actions: KeyboardActions) {
  useEffect(() => {
    const accepts = (event: KeyboardEvent) => {
      if (!actions.enabled || document.querySelector('[aria-modal="true"]') || event.defaultPrevented || event.isComposing) return false;
      const target = event.target;
      return target instanceof HTMLElement && !target.isContentEditable
        && !target.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="menu"], [role="listbox"]');
    };
    const playback = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !accepts(event)) return;
      const target = event.target as HTMLElement;
      if (target.closest('[role="switch"], [role="checkbox"], [role="radio"]')) return;
      // Claim Space before timeline selection and native button activation; Enter still activates buttons.
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) actions.play();
    };
    const keydown = (event: KeyboardEvent) => {
      if (!accepts(event)) return;
      const target = event.target as HTMLElement;
      const control = target.closest('button, [role="button"], [role="tab"], [role="slider"], [role="checkbox"]');
      const editorContext = target === document.body || !!target.closest('.editor-main, .inspector-panel');
      const selection = target.closest('[data-editor-selection]');
      const primary = event.ctrlKey || event.metaKey;
      if (primary && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') { event.preventDefault(); actions.save(); }
      else if (primary && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); actions.undo(); }
      else if (primary && !event.altKey && ((event.shiftKey && event.key.toLowerCase() === 'z')
        || !event.shiftKey && event.key.toLowerCase() === 'y')) { event.preventDefault(); actions.redo?.(); }
      else if (editorContext && !primary && !event.altKey && !event.shiftKey && ['Delete', 'Backspace'].includes(event.key)) {
        event.preventDefault(); if (!event.repeat) actions.remove?.();
      } else if (editorContext && event.key === 'Escape' && !primary && !event.altKey) { event.preventDefault(); actions.deselect?.(); }
      else if (editorContext && !primary && !event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)
        && (!control || selection)) { event.preventDefault(); actions.step?.(event.key === 'ArrowRight' ? 1 : -1, event.shiftKey); }
      else if (event.key.toLowerCase() === 's' && !primary && !event.altKey && !event.shiftKey && (!control || selection)) { event.preventDefault(); actions.split(); }
    };
    window.addEventListener('keydown', playback, true);
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('keydown', playback, true); window.removeEventListener('keydown', keydown); };
  }, [actions]);
}
