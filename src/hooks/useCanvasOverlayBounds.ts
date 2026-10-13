import { useEffect, useState, type RefObject } from 'react';

export function useCanvasOverlayBounds(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const [bounds, setBounds] = useState<{ left: number; top: number; width: number; height: number }>();
  useEffect(() => {
    const canvas = canvasRef.current, parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = canvas.getBoundingClientRect(), origin = parent.getBoundingClientRect();
      setBounds({ left: rect.left - origin.left + parent.scrollLeft, top: rect.top - origin.top + parent.scrollTop,
        width: rect.width, height: rect.height });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule); observer.observe(canvas); observer.observe(parent);
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true); measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [canvasRef]);
  return bounds;
}
