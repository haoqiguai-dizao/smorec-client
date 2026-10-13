import { useCallback, useEffect, useRef, useState } from 'react';
import type { MicrophoneEffects } from '../../shared/microphone-effects';
import { releaseAudioUrl, useAudioUrlLease } from './useAudioUrlLease';

type Phase = 'idle' | 'starting' | 'recording' | 'finishing' | 'ready';
interface Sample { id: string; url: string; duration: number }

export function useMicrophoneTrial(deviceId: string, enabled: boolean, effects: MicrophoneEffects) {
  const [phase, setPhase] = useState<Phase>('idle'), [sample, setSample] = useState<Sample>();
  const [processed, setProcessed] = useState(''), [processing, setProcessing] = useState(false);
  const [comparison, setComparison] = useState<'original' | 'effect'>('effect');
  const [playing, setPlaying] = useState(false), [elapsed, setElapsed] = useState(0), [error, setError] = useState<string>();
  const id = useRef<string | undefined>(undefined), generation = useRef(0), pending = useRef(false);
  const audio = useRef<HTMLAudioElement | undefined>(undefined), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), ticker = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const effectsKey = JSON.stringify(effects);
  useAudioUrlLease(processed || undefined, true);
  const stopPlayback = useCallback(() => {
    if (audio.current) { audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load(); audio.current = undefined; }
    setPlaying(false);
  }, []);
  const clearTimers = useCallback(() => { clearTimeout(timer.current); clearInterval(ticker.current); }, []);
  const finish = useCallback(async () => {
    const api = window.recorder, current = id.current, revision = generation.current;
    if (!api || !current || pending.current) return;
    pending.current = true; clearTimers(); setPhase('finishing');
    try {
      const result = await api.finishMicrophoneTrial(current);
      if (revision === generation.current) { setSample(result); setElapsed(result.duration); setPhase('ready'); }
    } catch (cause) {
      if (revision === generation.current) { setError(cause instanceof Error ? cause.message : '试录保存失败'); setPhase('idle'); }
    } finally { if (revision === generation.current) pending.current = false; }
  }, [clearTimers]);
  const start = async () => {
    const api = window.recorder;
    if (!api || !enabled || pending.current || phase === 'recording') return;
    const revision = ++generation.current;
    pending.current = true; stopPlayback(); clearTimers(); setError(undefined); setSample(undefined); setProcessed(''); setElapsed(0); setPhase('starting');
    try {
      if (id.current) await api.cancelMicrophoneTrial(id.current);
      id.current = undefined;
      const result = await api.startMicrophoneTrial(deviceId);
      if (revision !== generation.current) { await api.cancelMicrophoneTrial(result.id); return; }
      id.current = result.id; pending.current = false; setPhase('recording');
      const started = performance.now();
      ticker.current = setInterval(() => setElapsed(Math.min(10, (performance.now() - started) / 1000)), 100);
      timer.current = setTimeout(() => { void finish(); }, 10_000);
    } catch (cause) {
      if (revision === generation.current) { setError(cause instanceof Error ? cause.message : '无法开始试录'); setPhase('idle'); pending.current = false; }
    }
  };
  useEffect(() => {
    setPhase('idle'); setSample(undefined); setProcessed(''); setError(undefined); setElapsed(0); pending.current = false;
    return () => {
      generation.current++; clearTimers(); stopPlayback();
      const current = id.current; id.current = undefined;
      if (current) void window.recorder?.cancelMicrophoneTrial(current).catch(() => {});
    };
  }, [deviceId, enabled, clearTimers, stopPlayback]);
  useEffect(() => {
    stopPlayback(); setProcessed(''); setProcessing(false);
    if (!sample) return;
    let live = true;
    setProcessing(true); setError(undefined);
    const delay = setTimeout(() => {
      void window.recorder?.processMicrophoneTrial(sample.id, JSON.parse(effectsKey)).then(url => {
        if (live) { setProcessed(url); setProcessing(false); } else releaseAudioUrl(url, true);
      }).catch(cause => { if (live) { setProcessing(false); setError(cause instanceof Error ? cause.message : '声音效果处理失败'); } });
    }, 250);
    return () => { live = false; clearTimeout(delay); };
  }, [sample, effectsKey, stopPlayback]);
  const play = async () => {
    if (playing) { stopPlayback(); return; }
    const url = comparison === 'original' ? sample?.url : processed;
    if (!url || phase !== 'ready') return;
    const element = new Audio(url); audio.current = element;
    element.addEventListener('ended', stopPlayback, { once: true });
    element.addEventListener('error', () => { setError('试听音频无法播放'); stopPlayback(); }, { once: true });
    setPlaying(true);
    try { await element.play(); }
    catch (cause) { if (audio.current === element) { setError(cause instanceof Error ? cause.message : '试听播放失败'); stopPlayback(); } }
  };
  return { phase, sample, processing, playing, elapsed, error, start, finish, play, comparison,
    canPlay: phase === 'ready' && !!(comparison === 'original' ? sample?.url : processed),
    compare: (next: 'original' | 'effect') => { stopPlayback(); setComparison(next); } };
}
