import { useLayoutEffect, useRef, type RefObject } from 'react';
import { getExportCanvasSize, getPreviewCanvasSize, type CanvasSize } from '../../shared/canvas';
import type { Project } from '../../shared/types';

/** Observe CSS content area, never the backing bitmap; resizes cannot feed back into layout. */
export function usePreviewResolution(canvasRef: RefObject<HTMLCanvasElement | null>, project: Project | null,
  changed: () => void, suspend: () => void) {
  const size = useRef<CanvasSize | null>(null);
  const changedRef = useRef(changed); changedRef.current = changed;
  const suspendRef = useRef(suspend); suspendRef.current = suspend;
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !project) { size.current = null; return; }
    const container = canvas.closest<HTMLElement>('.canvas-viewport');
    const target = container ?? canvas;
    const output = getExportCanvasSize(project);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolution: MediaQueryList | undefined;
    const publish = () => {
      clearTimeout(timer); timer = undefined;
      if (document.hidden) { size.current = null; suspendRef.current(); return; }
      const bounds = target.getBoundingClientRect(), css = getComputedStyle(target);
      const width = bounds.width - (container ? parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) : 0);
      const height = bounds.height - (container ? parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) : 0);
      size.current = getPreviewCanvasSize(output, { width, height, density: window.devicePixelRatio });
      if (!size.current) return;
      if (container) {
        const fit = Math.min(width / output.width, height / output.height);
        canvas.style.width = `${output.width * fit}px`;
        canvas.style.height = `${output.height * fit}px`;
      }
      changedRef.current();
    };
    const resize = () => { clearTimeout(timer); timer = setTimeout(publish, 100); };
    const densityChanged = () => {
      resolution?.removeEventListener('change', densityChanged);
      resolution = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener('change', densityChanged); resize();
    };
    const observer = new ResizeObserver(resize); observer.observe(target);
    window.addEventListener('resize', resize); document.addEventListener('visibilitychange', publish);
    densityChanged(); publish();
    return () => {
      clearTimeout(timer); observer.disconnect(); size.current = null;
      resolution?.removeEventListener('change', densityChanged);
      window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', publish);
    };
  }, [canvasRef, project?.id, project?.width, project?.height, project?.style.aspect]);
  return size;
}
