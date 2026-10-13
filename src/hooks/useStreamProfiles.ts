import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_STREAM_ENCODING, type StreamProfileDraft, type StreamProfileSummary } from '../../shared/streaming';
import { recordingErrorMessage } from '../services/recording-error-message';

const blank = (): StreamProfileDraft => ({ ...DEFAULT_STREAM_ENCODING, name: '', server: '', key: '' });
export function useStreamProfiles() {
  const [profiles, setProfiles] = useState<StreamProfileSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<StreamProfileDraft>(blank);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const summaries = useRef<StreamProfileSummary[]>([]);
  const select = useCallback(async (id: string) => {
    const serial = ++generation.current;
    setError(undefined); setSelected(id); setBusy(true);
    try {
      const summary = summaries.current.find(item => item.id === id);
      if (summary?.needsCredentials) {
        const { needsCredentials: _needsCredentials, ...settings } = summary;
        setDraft({ ...settings, server: '', key: '' }); setDirty(true);
        setError('旧连接请重新填写地址和密钥，保存后无需钥匙串授权');
        return;
      }
      const value = id ? await window.live?.profiles?.read(id) : blank();
      if (generation.current !== serial) return;
      setDraft(value ?? blank()); setDirty(false);
      try { localStorage.setItem('xiaolu-stream-profile', id); } catch { /* Optional preference. */ }
    } catch (cause) {
      if (generation.current === serial) { setDraft(blank()); setSelected(''); setError(recordingErrorMessage(cause)); }
    } finally { if (generation.current === serial) setBusy(false); }
  }, []);
  const refresh = useCallback(async () => {
    if (!window.live?.profiles) return;
    try {
      const next = await window.live.profiles.list(); summaries.current = next; setProfiles(next);
      let previous = ''; try { previous = localStorage.getItem('xiaolu-stream-profile') ?? ''; } catch { /* Optional preference. */ }
      await select(next.some(item => item.id === previous) ? previous : next[0]?.id ?? '');
    } catch (cause) { setError(recordingErrorMessage(cause)); }
  }, [select]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  const change = (patch: Partial<StreamProfileDraft>) => { setDraft(value => ({ ...value, ...patch })); setDirty(true); setError(undefined); };
  const save = async (patch?: Partial<StreamProfileDraft>) => {
    if (busy || !window.live?.profiles) return;
    setBusy(true); setError(undefined);
    try {
      const saved = { ...draft, ...patch };
      const value = await window.live.profiles.save(saved);
      const next = await window.live.profiles.list(); summaries.current = next; setProfiles(next);
      setSelected(value.id); setDraft({ ...saved, id: value.id }); setDirty(false);
      try { localStorage.setItem('xiaolu-stream-profile', value.id); } catch { /* Optional preference. */ }
      return value.id;
    } catch (cause) { setError(recordingErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (busy || !selected || !window.live?.profiles) return;
    setBusy(true); setError(undefined);
    try {
      await window.live.profiles.remove(selected);
      const next = await window.live.profiles.list(); summaries.current = next; setProfiles(next); await select(next[0]?.id ?? '');
    } catch (cause) { setError(recordingErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  return { profiles, selected, draft, busy, dirty, error, change, select, save, remove,
    ready: !!selected && !!draft.id && !dirty && !busy && !error };
}
export type StreamProfilesModel = ReturnType<typeof useStreamProfiles>;
