import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../shared/types';
import { normalizeMicrophoneEffects } from '../../shared/microphone-effects';
import { releaseAudioUrl, useAudioUrlLease } from './useAudioUrlLease';

/** Prepare effects independently of transport; keep the current source until its replacement is ready. */
export function useProcessedMicrophone(project: Project | null, onError: (message: string) => void) {
  const effects = normalizeMicrophoneEffects(project?.audio.microphoneEffects);
  const source = project?.media.microphone, id = project?.id;
  const key = JSON.stringify(effects), enabled = !!source && effects.enabled;
  const requestKey = `${id ?? ''}:${source ?? ''}:${key}`;
  const [result, setResult] = useState<{ key: string; source?: string; url?: string; error?: string }>({ key: '' });
  const errorRef = useRef(onError); errorRef.current = onError;
  useEffect(() => {
    if (!enabled || !id) return;
    let live = true;
    const timer = setTimeout(() => {
      const api = window.studio;
      if (!api) { const error = '声音效果需要小录桌面版'; setResult({ key: requestKey, error }); return; }
      void api.prepareMicrophone(id, JSON.parse(key)).then(url => {
        if (live) setResult({ key: requestKey, source, url }); else releaseAudioUrl(url);
      })
        .catch(cause => {
          if (!live) return;
          const error = cause instanceof Error ? cause.message : '麦克风效果处理失败，可恢复原声后重试';
          setResult({ key: requestKey, error }); errorRef.current(error);
        });
    }, 250);
    return () => { live = false; clearTimeout(timer); void window.studio?.cancelMicrophonePreparation().catch(() => {}); };
  }, [enabled, id, source, key, requestKey]);
  const current = result.key === requestKey ? result : undefined;
  const previous = result.source === source && result.key.startsWith(`${id}:`) ? result.url : undefined;
  useAudioUrlLease(result.url);
  return { url: enabled ? current?.error ? source : current?.url ?? previous ?? source : source, ready: !enabled || !!current?.url,
    error: enabled ? current?.error : undefined };
}
