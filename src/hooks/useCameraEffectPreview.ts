import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CameraEffects, WebcamStyle } from '../../shared/types';
import { drawPresenter } from '../services/webcam-compositor';
import { ORIGINAL_CAMERA_EFFECTS } from '../../shared/camera-effects';
import { CameraPreviewRenderer } from '../services/camera-effects/preview-renderer';
import { cameraPreviewNextPaint } from '../services/camera-effects/preview-budget';
import { FACE_READY_EVENT } from '../services/camera-effects/face/tracker';

/** Paint only decoded camera frames. The original MediaStream remains owned by the recorder. */
export function useCameraEffectPreview(video: RefObject<HTMLVideoElement | null>, canvas: RefObject<HTMLCanvasElement | null>,
  stream: MediaStream | null, effects?: CameraEffects, enabled = true,
  framing?: Pick<WebcamStyle, 'zoom' | 'mirror' | 'presenterCrop'>, onPaint?: (stream: MediaStream) => void, paintWhileHidden = false) {
  const effectsRef = useRef(effects); effectsRef.current = effects;
  const framingRef = useRef(framing); framingRef.current = framing;
  const paintedRef = useRef(onPaint); paintedRef.current = onPaint;
  const hiddenPaint = useRef(paintWhileHidden); hiddenPaint.current = paintWhileHidden;
  const repaint = useRef<() => void>(() => {});
  const [error, setError] = useState<string>();
  useEffect(() => {
    const element = video.current, target = canvas.current;
    if (!element || !target || !stream || !enabled) return;
    const renderer = new CameraPreviewRenderer();
    const context = target.getContext('2d', { alpha: false });
    let stopped = false, callback = 0, fallback = 0, previousError = '', nextPaintAt = 0, lastMediaTime = -1;
    setError(undefined);
    const paint = (force = false) => {
      if (stopped || document.hidden && !hiddenPaint.current || !context || element.srcObject !== stream || element.readyState < 2 || !element.videoWidth) return;
      const started = performance.now();
      if (!force && (started + 1 < nextPaintAt || element.currentTime === lastMediaTime)) return;
      try {
        const output = renderer.render(element, effectsRef.current ?? ORIGINAL_CAMERA_EFFECTS,
          target.getBoundingClientRect(), window.devicePixelRatio);
        if (!output) return;
        const { width, height } = output;
        if (target.width !== width) target.width = width;
        if (target.height !== height) target.height = height;
        if (framingRef.current) drawPresenter(context, output.source, framingRef.current as WebcamStyle, width, height);
        else context.drawImage(output.source, 0, 0, width, height);
        lastMediaTime = element.currentTime;
        target.dataset.frameTime = String(element.currentTime);
        target.dataset.effectsEnabled = String(effectsRef.current?.enabled ?? false);
        paintedRef.current?.(stream);
        if (previousError) { previousError = ''; setError(undefined); }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '摄像头效果暂不可用';
        if (message !== previousError) { previousError = message; setError(message); }
      } finally {
        const finished = performance.now();
        nextPaintAt = cameraPreviewNextPaint(started, finished, renderer.backend);
      }
    };
    repaint.current = () => paint(true);
    const schedule = () => {
      if (stopped || document.hidden && !hiddenPaint.current || callback || fallback) return;
      if (typeof element.requestVideoFrameCallback === 'function') callback = element.requestVideoFrameCallback(() => { callback = 0; paint(); schedule(); });
      else fallback = requestAnimationFrame(() => { fallback = 0; paint(); schedule(); });
    };
    const cancel = () => {
      if (callback) element.cancelVideoFrameCallback(callback);
      if (fallback) cancelAnimationFrame(fallback);
      callback = 0; fallback = 0;
    };
    const refresh = () => { paint(true); schedule(); };
    const visibilityChanged = () => { cancel(); if (!document.hidden || hiddenPaint.current) refresh(); };
    const resize = new ResizeObserver(refresh); resize.observe(target);
    element.addEventListener('loadeddata', refresh);
    window.addEventListener(FACE_READY_EVENT, refresh);
    document.addEventListener('visibilitychange', visibilityChanged);
    refresh();
    return () => {
      stopped = true; repaint.current = () => {};
      element.removeEventListener('loadeddata', refresh);
      window.removeEventListener(FACE_READY_EVENT, refresh);
      document.removeEventListener('visibilitychange', visibilityChanged);
      resize.disconnect(); cancel();
      renderer.dispose();
      context?.clearRect(0, 0, target.width, target.height);
    };
  }, [video, canvas, stream, enabled]);
  useEffect(() => repaint.current(), [effects]);
  useEffect(() => repaint.current(), [framing]);
  return error;
}
