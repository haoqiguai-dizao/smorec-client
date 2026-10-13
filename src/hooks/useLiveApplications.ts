import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveApplication } from '../../shared/live-types';
import { recordingErrorMessage } from '../services/recording-error-message';
import { applicationSelected, defaultLiveApplicationSelection, liveApplicationChoices, parseLiveApplications,
  readLiveApplicationSelection, saveLiveApplicationSelection, updateLiveApplicationSelection } from '../services/live-application-preferences';

function initialSelection() {
  try { return { selected: readLiveApplicationSelection(), error: undefined as string | undefined }; }
  catch { return { selected: [] as LiveApplication[], error: '未能读取已保存的排除应用，请重新勾选' }; }
}

export function useLiveApplications(busy: boolean, apply?: (selected: LiveApplication[]) => Promise<void>) {
  const [initial] = useState(initialSelection);
  const [current, setCurrent] = useState<LiveApplication[]>([]);
  const [selected, setSelected] = useState<LiveApplication[]>(initial.selected ?? []);
  const [loading, setLoading] = useState(false), [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [storageError, setStorageError] = useState(initial.error);
  const [selectionError, setSelectionError] = useState<string>();
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const applyRef = useRef(apply); applyRef.current = apply;
  const retryPreference = useRef<'read' | 'write' | undefined>(initial.error ? 'read' : undefined);
  const explicit = useRef(initial.selected);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const busyRef = useRef(busy); busyRef.current = busy;
  const revision = useRef(0), mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (busyRef.current || applyingRef.current) return;
    const request = ++revision.current;
    setLoading(true); setLoadError(undefined);
    if (retryPreference.current) {
      try {
        if (retryPreference.current === 'write') saveLiveApplicationSelection(selectedRef.current);
        else {
          const restored = readLiveApplicationSelection(); explicit.current = restored;
          selectedRef.current = restored ?? []; setSelected(restored ?? []);
        }
        retryPreference.current = undefined; setStorageError(undefined);
      } catch { /* Keep the visible storage error until an explicit retry or selection succeeds. */ }
    }
    try {
      if (!window.live) throw new Error('请从小录桌面版读取应用列表');
      const applications = parseLiveApplications(await window.live.applications());
      if (!mounted.current || request !== revision.current) return;
      setCurrent(applications); setLoaded(true);
      // Keep a successfully loaded picker usable even if applying the refreshed windows fails.
      // Refresh also re-resolves windows belonging to the same selected applications.
      const next = explicit.current === undefined ? defaultLiveApplicationSelection(applications) : selectedRef.current;
      try { await applyRef.current?.(next); }
      catch (cause) {
        if (mounted.current && request === revision.current) setSelectionError(recordingErrorMessage(cause));
        return;
      }
      if (!mounted.current || request !== revision.current) return;
      setSelectionError(undefined);
      if (explicit.current === undefined) {
        selectedRef.current = next; setSelected(next);
      }
    } catch (cause) {
      if (mounted.current && request === revision.current) setLoadError(recordingErrorMessage(cause));
    } finally { if (mounted.current && request === revision.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh();
    return () => { mounted.current = false; revision.current++; };
  }, [refresh]);
  const toggle = async (application: LiveApplication, checked: boolean) => {
    if (busyRef.current || applyingRef.current || loading || !loaded) return;
    let next: LiveApplication[];
    try { next = updateLiveApplicationSelection(selectedRef.current, application, checked); setSelectionError(undefined); }
    catch (cause) { setSelectionError(recordingErrorMessage(cause)); return; }
    applyingRef.current = true; setApplying(true);
    try { await applyRef.current?.(next); }
    catch (cause) { if (mounted.current) setSelectionError(recordingErrorMessage(cause)); return; }
    finally { applyingRef.current = false; if (mounted.current) setApplying(false); }
    if (!mounted.current) return;
    explicit.current = next; selectedRef.current = next; setSelected(next); setLoadError(undefined);
    try { saveLiveApplicationSelection(next); retryPreference.current = undefined; setStorageError(undefined); }
    catch { retryPreference.current = 'write'; setStorageError('排除应用已更新，但未能保存，下次打开需重新选择'); }
  };
  return { choices: liveApplicationChoices(current, selected), selected, loading, applying, ready: loaded && !loading && !applying,
    error: loadError ?? selectionError ?? storageError, refresh, toggle, includes: (id: string) => applicationSelected(selected, id) };
}
export type LiveApplicationsModel = ReturnType<typeof useLiveApplications>;
