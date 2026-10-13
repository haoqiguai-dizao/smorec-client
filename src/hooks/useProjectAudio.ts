import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../shared/types';
import { normalizeMicrophoneEffects } from '../../shared/microphone-effects';
import { useProcessedMicrophone } from './useProcessedMicrophone';
import { releaseAudioUrl, useAudioUrlLease } from './useAudioUrlLease';

/** Retain independent stems for live gain changes while the export-identical mix prepares. */
export function useProjectAudio(project: Project | null, onError: (message: string) => void) {
  const mixed = !!project?.media.systemAudio && !!project.media.microphone;
  const microphone = useProcessedMicrophone(mixed ? null : project, onError);
  const id = project?.id, source = project?.media.microphone;
  const effects = JSON.stringify(normalizeMicrophoneEffects(project?.audio.microphoneEffects));
  const audio = JSON.stringify({ system: project?.audio.system, microphone: project?.audio.microphone,
    microphoneEffects: JSON.parse(effects) });
  const sourceKey = `${id ?? ''}:${source ?? ''}`;
  const effectKey = `${sourceKey}:${effects}`;
  const requestKey = `${sourceKey}:${project?.media.systemAudio ?? ''}:${project?.duration ?? 0}:${audio}`;
  const [result, setResult] = useState<{ key: string; url?: string; error?: string }>({ key: '' });
  const [stem, setStem] = useState<{ key: string; sourceKey: string; url: string }>();
  const cachedStem = useRef(stem);
  const errorRef = useRef(onError); errorRef.current = onError;
  useEffect(() => {
    if (!mixed || !id || !source) return;
    let live = true;
    const timer = setTimeout(() => {
      const api = window.studio;
      if (!api) { setResult({ key: requestKey, error: '声音混音需要小录桌面版' }); return; }
      void (async () => {
        // The native session has one preparation job: resolve the stem before requesting the mix.
        if (cachedStem.current?.key !== effectKey) {
          const parameters = JSON.parse(effects);
          const url = parameters.enabled ? await api.prepareMicrophone(id, parameters) : source;
          if (!live) { releaseAudioUrl(url); return; }
          const next = { key: effectKey, sourceKey, url };
          cachedStem.current = next; setStem(next);
        }
        const url = await api.prepareAudio(id, JSON.parse(audio));
        if (live) setResult({ key: requestKey, url }); else releaseAudioUrl(url);
      })().catch(cause => {
        if (!live) return;
        const error = cause instanceof Error ? cause.message : '声音混音失败，请重新打开工程';
        setResult({ key: requestKey, error }); errorRef.current(error);
      });
    }, 250);
    return () => { live = false; clearTimeout(timer); void window.studio?.cancelMicrophonePreparation().catch(() => {}); };
  }, [mixed, id, source, sourceKey, effectKey, effects, audio, requestKey]);
  const current = result.key === requestKey ? result : undefined;
  const microphoneUrl = !JSON.parse(effects).enabled ? source
    : stem?.sourceKey === sourceKey && (!current?.error || stem.key === effectKey) ? stem.url : source;
  useAudioUrlLease(result.url);
  useAudioUrlLease(stem?.url);
  return mixed ? { mixed, url: current?.url, microphoneUrl, ready: !!current?.url, error: current?.error }
    : { ...microphone, mixed, microphoneUrl: microphone.url };
}
