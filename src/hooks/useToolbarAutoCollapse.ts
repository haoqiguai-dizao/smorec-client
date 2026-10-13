import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FocusEvent } from 'react';
import type { ToolbarRegion } from '../../shared/toolbar-types';
import { ToolbarAutoCollapse } from '../services/toolbar-auto-collapse';

function keyboardFocus(element: Element | null): boolean {
  return !!element?.matches(':focus-visible, input, select, textarea, [contenteditable="true"]');
}
function visibleRegions(root: HTMLElement): ToolbarRegion[] {
  return [...root.querySelectorAll<HTMLElement>('[data-toolbar-surface]')].flatMap(element => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || getComputedStyle(element).visibility === 'hidden') return [];
    // Keep a small shadow margin, without retaining the large transparent window as a hit target.
    return [{ x: rect.left - 5, y: rect.top - 5, width: rect.width + 10, height: rect.height + 10 }];
  });
}
function alignCompactStop(root: HTMLElement): void {
  const stop = root.querySelector<HTMLElement>('[data-toolbar-focus="stop"]');
  if (!stop || stop.closest('.compact-toolbar')) return;
  const rect = stop.getBoundingClientRect(), outer = root.getBoundingClientRect(), style = getComputedStyle(root);
  if (!rect.width || !rect.height) return;
  // The compact stop is 26px wide, 8px from its 1px border; keep its center inside the full stop.
  const right = Math.max(0, outer.right - parseFloat(style.paddingRight || '0') - (rect.left + rect.width / 2 + 22));
  const bottom = Math.max(0, outer.bottom - parseFloat(style.paddingBottom || '0') - (rect.top + rect.height / 2 + 17));
  for (const [key, value] of [['--compact-toolbar-margin-right', right], ['--compact-toolbar-margin-bottom', bottom]] as const) {
    const next = `${value}px`; if (root.style.getPropertyValue(key) !== next) root.style.setProperty(key, next);
  }
}

export function useToolbarAutoCollapse({ enabled, keepExpanded = false, delayMs = 700 }: {
  enabled: boolean; keepExpanded?: boolean; delayMs?: number;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [controller] = useState(() => new ToolbarAutoCollapse());
  const collapsed = useSyncExternalStore(controller.subscribe, controller.snapshot, () => false);
  useLayoutEffect(() => {
    if (collapsed || !pendingFocus.current || !containerRef.current) return;
    const key = pendingFocus.current; pendingFocus.current = null;
    const target = containerRef.current.querySelector<HTMLElement>(`[data-toolbar-focus="${key}"]:not(:disabled)`)
      ?? containerRef.current.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
    target?.focus({ preventScroll: true });
  }, [collapsed]);
  useLayoutEffect(() => { if (!collapsed && containerRef.current) alignCompactStop(containerRef.current); });
  useEffect(() => {
    controller.configure(enabled, keepExpanded, delayMs);
    return () => controller.dispose();
  }, [controller, enabled, keepExpanded, delayMs]);
  useEffect(() => {
    const blur = () => { controller.pointer(false); controller.focus(false); };
    const focus = () => controller.focus(!!containerRef.current?.contains(document.activeElement) && keyboardFocus(document.activeElement));
    window.addEventListener('blur', blur); window.addEventListener('focus', focus);
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); };
  }, [controller]);
  useLayoutEffect(() => {
    const api = window.toolbarPresentation, root = containerRef.current;
    if (!api || !root) return;
    let last = '', frame = 0, disposed = false;
    const measure = () => {
      frame = 0;
      if (disposed) return;
      alignCompactStop(root);
      const regions = enabled ? visibleRegions(root) : null;
      if (regions && !regions.length) return;
      const signature = JSON.stringify(regions);
      if (signature === last) return;
      last = signature;
      void api.setRegions(regions).catch(error => { last = ''; console.warn('操作栏可见区域更新失败', error); });
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(queue), mutation = new MutationObserver(queue);
    resize.observe(root);
    root.querySelectorAll('[data-toolbar-surface]').forEach(element => resize.observe(element));
    mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    window.addEventListener('resize', queue); measure();
    return () => { disposed = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', queue); };
  }, [enabled, keepExpanded, collapsed]);
  useEffect(() => () => { void window.toolbarPresentation?.setRegions(null).catch(() => {}); }, []);

  const interactionProps = {
    onPointerEnter: () => controller.pointer(true),
    onPointerLeave: () => controller.pointer(false),
    onFocusCapture: (event: FocusEvent<HTMLElement>) => {
      const keyboard = keyboardFocus(event.target);
      if (collapsed && keyboard) pendingFocus.current = event.target.dataset.toolbarFocus ?? 'expand';
      controller.focus(keyboard);
    },
    onBlurCapture: (event: FocusEvent<HTMLElement>) => {
      controller.focus(event.currentTarget.contains(event.relatedTarget) && keyboardFocus(event.relatedTarget as Element | null));
    },
    onKeyDownCapture: () => controller.focus(true),
  };
  return { collapsed: enabled && !keepExpanded && collapsed, containerRef, interactionProps, expand: controller.expand, collapse: controller.collapse };
}
