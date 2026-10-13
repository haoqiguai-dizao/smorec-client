import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveAction, LiveOptions, LiveState, VirtualCameraStatus } from '../../shared/live-types';
import { LiveRuntime } from '../services/live/runtime';
import { LIVE_CAMERA_WARNING } from '../../shared/live-issues';
import { recordingErrorMessage } from '../services/recording-error-message';
import { useLiveApplications } from './useLiveApplications';
import { useStreamProfiles } from './useStreamProfiles';
import type { LiveOutputMode } from '../../shared/streaming';
import type { LiveApplication } from '../../shared/live-types';

const PREVIEW_ERROR = '画面预览暂不可用，输出继续；可重新开启预览';

export function useLiveSession(stream: () => MediaStream | null, applyRecordingExclusions?: (selected: LiveApplication[]) => Promise<void>) {
  const [state, setState] = useState<LiveState>({ status: 'idle' });
  const [device, setDevice] = useState<VirtualCameraStatus>();
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();
  const [portrait, setPortrait] = useState(false);
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const [zoomAvailable, setZoomAvailable] = useState(true);
  const inputEnabled = useRef(true);
  const [output, setOutput] = useState<LiveOutputMode>('stream');
  const [previewReady, setPreviewReady] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null), lastMeter = useRef(0);
  const profiles = useStreamProfiles();
  const runtime = useRef<LiveRuntime | undefined>(undefined);
  const previewEnabledRef = useRef(true), windowVisible = useRef(true);
  const streamRef = useRef(stream); streamRef.current = stream;
  const active = ['starting', 'live', 'stopping'].includes(state.status);
  const applications = useLiveApplications(installing || state.status === 'starting' || state.status === 'stopping', async selected => {
    if (state.status !== 'live') { await applyRecordingExclusions?.(selected); return; }
    if (!window.live || !state.id) throw new Error('投屏会话已结束');
    await window.live.setExcludedApplications(state.id, selected.map(application => application.id));
  });
  const action = useCallback((value: LiveAction) => {
    if (!runtime.current) return;
    if (value === 'toggle-auto-zoom' && !inputEnabled.current) return;
    runtime.current.action(value);
    if (value === 'toggle-auto-zoom') setZoomEnabled(enabled => !enabled);
  }, []);
  const togglePreview = useCallback(() => {
    previewEnabledRef.current = !previewEnabledRef.current;
    setPreviewEnabled(previewEnabledRef.current);
    runtime.current?.setPreviewEnabled(previewEnabledRef.current);
    if (previewEnabledRef.current) setError(previous => previous === PREVIEW_ERROR ? undefined : previous);
  }, []);
  const refresh = useCallback(async () => {
    try { const next = await window.live?.status(); setDevice(next); }
    catch (cause) { setError(recordingErrorMessage(cause)); }
  }, []);
  useEffect(() => {
    const api = window.live;
    if (!api) return;
    void refresh();
    const offState = api.onState(next => {
      setState(next);
      if (next.error) setError(recordingErrorMessage(next.error));
      else setError(previous => previous === LIVE_CAMERA_WARNING ? undefined : previous);
      if (next.status === 'stopping') void runtime.current?.stop();
      if (next.status === 'idle' || next.status === 'error') {
        void runtime.current?.stop(); runtime.current = undefined; setPreviewReady(false); setAudioLevel(0);
      }
    });
    const offAction = api.onAction(action);
    const offVisibility = api.onPreviewVisibility?.(visible => {
      windowVisible.current = visible; runtime.current?.setPreviewVisible(visible);
    });
    return () => { offState(); offAction(); offVisibility?.(); void runtime.current?.stop(); };
  }, [refresh, action]);
  const start = async (options: LiveOptions) => {
    const api = window.live;
    if (!api || active || runtime.current) return;
    if (!applications.ready) { setError('请先刷新并确认排除应用列表'); return; }
    inputEnabled.current = options.inputRecording !== false;
    setZoomAvailable(inputEnabled.current); setZoomEnabled(inputEnabled.current);
    setError(undefined); setPreviewReady(false); setAudioLevel(0); setState({ status: 'starting' });
    try {
      if (output === 'stream' && !profiles.ready) throw new Error('请先保存并选择推流配置');
      const config = await api.start({ ...options, portrait, output, ...(output === 'stream' ? { streamProfileId: profiles.selected } : {}),
        excludedApplications: applications.selected.map(application => application.id) });
      const next = runtime.current = new LiveRuntime(api, config, () => streamRef.current(), (cause, issue) => {
        setError(recordingErrorMessage(cause));
        void (api.report ? api.report(config.id, issue) : api.stop()).catch(() => undefined);
      }, {
        notice: issue => { void api.report?.(config.id, issue).catch(() => undefined); },
        preview: canvas => {
          if (previewRef.current && canvas.parentElement !== previewRef.current) previewRef.current.replaceChildren(canvas);
        },
        visible: () => Boolean(previewRef.current),
        progress: level => {
          if (performance.now() - lastMeter.current > 100) { lastMeter.current = performance.now(); setAudioLevel(level); setPreviewReady(true); }
        },
        failed: () => { setPreviewEnabled(false); previewEnabledRef.current = false; setError(PREVIEW_ERROR); },
      });
      next.setPreviewEnabled(previewEnabledRef.current); next.setPreviewVisible(windowVisible.current);
      next.start();
    } catch (cause) { setError(recordingErrorMessage(cause)); setState({ status: 'error' }); }
  };
  const stop = async () => {
    const stopped = runtime.current?.stop();
    try { await window.live?.stop(); await stopped; runtime.current = undefined; setPreviewReady(false); setAudioLevel(0); }
    catch (cause) { setError(recordingErrorMessage(cause)); }
  };
  const broadcast = async () => {
    if (connecting || !previewReady || state.phase !== 'preview' || !state.id) return;
    setConnecting(true); setError(undefined);
    try {
      if (!window.live?.broadcast) throw new Error('请更新小录后开始直播');
      await window.live.broadcast(state.id);
    } catch (cause) { setError(recordingErrorMessage(cause)); }
    finally { setConnecting(false); }
  };
  const install = async () => {
    if (installing || active) return;
    setInstalling(true); setError(undefined);
    try { setDevice(await window.live?.install()); }
    catch (cause) { setError(recordingErrorMessage(cause)); }
    finally { setInstalling(false); }
  };
  return { state, active, device, applications, error, clearError: () => setError(undefined), portrait, setPortrait, zoomEnabled, zoomAvailable, action, refresh, start, stop,
    install, installing, output, setOutput, profiles, previewRef, previewReady, previewEnabled, togglePreview, audioLevel, connecting, broadcast };
}
export type LiveSessionModel = ReturnType<typeof useLiveSession>;
