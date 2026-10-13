import { useEffect, useRef, type RefObject } from 'react';
import type { CameraPreviewDisplay } from '../../shared/camera-preview';

const EMPTY: CameraPreviewDisplay = { width: 0, height: 0, density: 1, visible: false };

/** Trailing resize updates; visibility changes are immediate and do not wait for decoded video. */
export function useCameraPreviewViewport(target: RefObject<HTMLElement | null>, visible: boolean,
  changed: (viewport: CameraPreviewDisplay) => void, preparing = false) {
  const latest = useRef<CameraPreviewDisplay>(EMPTY);
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolution: MediaQueryList | undefined;
    const publish = () => {
      clearTimeout(timer); timer = undefined;
      const bounds = element.getBoundingClientRect();
      const value = { width: Math.min(8192, Math.max(0, bounds.width)), height: Math.min(8192, Math.max(0, bounds.height)),
        density: Math.min(8, Math.max(.5, window.devicePixelRatio || 1)), visible: visible && (!document.hidden || preparing) };
      if (Object.entries(value).some(([key, value]) => latest.current[key as keyof CameraPreviewDisplay] !== value)) {
        latest.current = value; changed(value);
      }
    };
    const resize = () => { clearTimeout(timer); timer = setTimeout(publish, 100); };
    const densityChanged = () => {
      resolution?.removeEventListener('change', densityChanged);
      resolution = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener('change', densityChanged); resize();
    };
    const observer = new ResizeObserver(resize); observer.observe(element);
    window.addEventListener('resize', resize); document.addEventListener('visibilitychange', publish);
    densityChanged(); publish();
    return () => {
      clearTimeout(timer); observer.disconnect(); resolution?.removeEventListener('change', densityChanged);
      window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', publish);
    };
  }, [target, visible, changed, preparing]);
  return latest;
}
