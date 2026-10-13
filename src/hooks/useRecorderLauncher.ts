import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppStatus, CameraEffects, CaptureSource, MicrophoneDevice, RecordingState, Rect } from '../../shared/types';
import { useWebcam } from './useWebcam';
import { usePreparedCameraPreview } from './usePreparedCameraPreview';
import { useMicrophoneSettings } from './useMicrophoneSettings';
import { recordingErrorMessage as errorMessage } from '../services/recording-error-message';
import { readRecordingDevicePreference, saveRecordingDevicePreference } from '../services/recording-device-preferences';
import { readAppPreferences, updateAppPreferences, type AppPreferencesPatch } from '../services/app-preferences';
import { recordingOutputSize, type RecordingResolution } from '../../shared/recording';
import type { LiveApplicationsModel } from './useLiveApplications';
import { useCapturePermissions } from './useCapturePermissions';
import { useOperationRecording } from './useOperationRecording';
import '../../shared/region-selection';

export type LauncherMode = 'screen' | 'window' | 'region';
export type LauncherPanel = 'mode' | 'sources' | 'camera' | 'microphone' | 'more' | 'applications' | 'permissions' | null;

function validCrop(crop: Rect, width: number, height: number) {
  return Object.values(crop).every(Number.isInteger) && crop.x >= 0 && crop.y >= 0 && crop.width >= 32 && crop.height >= 32
    && crop.x + crop.width <= width && crop.y + crop.height <= height;
}
function countdownTick(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 1000);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

export function useRecorderLauncher({ externalBusy = false, externalError, applications, permissionMicrophone }: {
  externalBusy?: boolean; externalError?: string; applications?: LiveApplicationsModel; permissionMicrophone?: boolean;
} = {}) {
  const [initialPreferences] = useState(() => readAppPreferences().recording);
  const preferences = useRef(initialPreferences);
  const remember = useCallback((patch: AppPreferencesPatch['recording']) => {
    preferences.current = updateAppPreferences({ recording: patch }).recording;
  }, []);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [state, setState] = useState<RecordingState>({ status: 'idle' });
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState<string>();
  const [dismissedMissingSource, setDismissedMissingSource] = useState('');
  const [activationRevision, setActivationRevision] = useState(0);
  const [mode, setMode] = useState<LauncherMode>(initialPreferences.mode);
  const [sourceId, setSourceId] = useState(initialPreferences.mode === 'window' ? '' : initialPreferences.screenSourceId);
  const sourceSelection = useRef({ mode, sourceId }); sourceSelection.current = { mode, sourceId };
  const [panel, setPanel] = useState<LauncherPanel>(initialPreferences.mode === 'window' ? 'sources' : null);
  const [error, setError] = useState<string>();
  const [cameraNotice, setCameraNotice] = useState<string>();
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const [fps, setFps] = useState<30 | 60>(initialPreferences.fps);
  const [resolution, setResolution] = useState<RecordingResolution>(initialPreferences.resolution);
  const [systemAudio, setSystemAudio] = useState(initialPreferences.systemAudio);
  const [microphone, setMicrophone] = useState(initialPreferences.microphoneEnabled);
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState(() => readRecordingDevicePreference('microphone'));
  const microphoneSettings = useMicrophoneSettings(microphoneDeviceId);
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [loadingMicrophones, setLoadingMicrophones] = useState(false);
  const [microphoneError, setMicrophoneError] = useState<string>();
  const [countdown, setCountdown] = useState<number | null>(null);
  const [selectingRegion, setSelectingRegion] = useState(false);
  const [cameraEffects, setCameraEffects] = useState<CameraEffects>(initialPreferences.cameraEffects);
  const camera = useWebcam(setCameraNotice);
  usePreparedCameraPreview(camera.stream, camera.sessionId(), cameraEffects, setCameraNotice);
  const cameraRef = useRef(camera); cameraRef.current = camera;
  const sourceRequest = useRef(0), microphoneRequest = useRef(0);
  const starting = useRef(false), countdownAbort = useRef<AbortController | null>(null);
  const busy = externalBusy || selectingRegion || countdown !== null || ['starting', 'recording', 'stopping'].includes(state.status);
  const operationRecording = useOperationRecording(initialPreferences, externalBusy || ['starting', 'recording', 'stopping'].includes(state.status), remember);
  const { inputRecording, inputNeedsConfirmation } = operationRecording;
  const microphoneAvailability = useRef({ microphone, busy }); microphoneAvailability.current = { microphone, busy };
  const visibleSources = sources.filter(source => source.kind === (mode === 'window' ? 'window' : 'screen'));
  // A window handle can be reused after restart. Restore the mode, never a window identity.
  const selected = sourceId ? visibleSources.find(source => source.id === sourceId) : mode === 'window' ? undefined : visibleSources[0];
  const missingSource = !!sourceId && !selected && !loadingSources;
  const displayedError = externalError ?? error ?? cameraNotice ?? sourceError ?? (missingSource && dismissedMissingSource !== sourceId
    ? `所选${mode === 'window' ? '窗口已关闭' : '屏幕已断开'}，请重新选择`
    : mode === 'window' && !sourceId && !loadingSources ? '请选择要录制的窗口' : undefined);
  const selectedWidth = selected?.width ?? 0, selectedHeight = selected?.height ?? 0;
  const cropValid = validCrop(crop, selectedWidth, selectedHeight);
  let output: { width: number; height: number } | undefined, outputError: string | undefined;
  if (selected && (mode !== 'region' || cropValid)) {
    try { output = recordingOutputSize(mode === 'region' ? crop.width : selectedWidth, mode === 'region' ? crop.height : selectedHeight, resolution); }
    catch (cause) { outputError = errorMessage(cause); }
  }
  const microphoneMissing = microphoneDeviceId && !microphones.some(device => device.id === microphoneDeviceId);
  const microphoneReady = !microphone || (!loadingMicrophones && !microphoneError && !!microphones.length && !microphoneMissing);
  const cameraReady = !camera.enabled || (!!camera.stream?.getVideoTracks().some(track => track.readyState === 'live') && !camera.loading && !camera.error);
  const recordingReady = !!status?.nativeAvailable && !!output && !outputError && !!selected && !loadingSources && !sourceError && cameraReady && (mode !== 'region' || cropValid) && !busy;
  const permissions = useCapturePermissions({ enabled: status?.platform === 'darwin', camera: camera.enabled,
    microphone: permissionMicrophone ?? microphone, inputRecording,
    expanded: panel === 'permissions', restored: () => {
      void refreshSources(); if (microphone) void refreshMicrophones();
      if (camera.enabled && camera.error) camera.onRefresh();
      if (panel === 'permissions') setPanel(null);
    } });
  const canConfigurePermissions = (permissions.blocked || permissions.enabled && inputNeedsConfirmation) && !busy;
  const canStart = recordingReady && microphoneReady && (!permissions.enabled || permissions.ready);
  // A microphone failure must have an actionable path without silently dropping its audio.
  const canConfigureMicrophone = recordingReady && !microphoneReady && !loadingMicrophones;
  const clearError = useCallback(() => {
    setError(undefined); setCameraNotice(undefined); setSourceError(undefined); setDismissedMissingSource(sourceId);
  }, [sourceId]);
  const chooseMicrophoneDevice = useCallback((id: string) => {
    setMicrophoneDeviceId(id); saveRecordingDevicePreference('microphone', id);
  }, []);

  const refreshSources = useCallback(async () => {
    const request = ++sourceRequest.current;
    setLoadingSources(true);
    try {
      if (!window.recorder) throw new Error('请从小录桌面版打开录制栏');
      const list = await window.recorder.getSources();
      if (request === sourceRequest.current) { setSources(list); setSourceError(undefined); }
    } catch (cause) { if (request === sourceRequest.current) setSourceError(errorMessage(cause)); }
    finally { if (request === sourceRequest.current) setLoadingSources(false); }
  }, []);
  const refreshMicrophones = useCallback(async () => {
    const request = ++microphoneRequest.current;
    setLoadingMicrophones(true); setMicrophoneError(undefined);
    try {
      if (!window.recorder) throw new Error('请从小录桌面版选择麦克风');
      const list = await window.recorder.getMicrophones();
      if (request === microphoneRequest.current) setMicrophones(list);
    } catch (cause) { if (request === microphoneRequest.current) setMicrophoneError(errorMessage(cause)); }
    finally { if (request === microphoneRequest.current) setLoadingMicrophones(false); }
  }, []);

  useEffect(() => {
    const api = window.recorder;
    if (!api) { setError('请从小录桌面版打开录制栏'); return; }
    void api.getStatus().then(next => {
      setStatus(next);
      if (!next.nativeAvailable) setError('录制引擎未就绪，请重新安装小录');
    }).catch(cause => setError(errorMessage(cause)));
    void refreshSources();
    let previousError: string | undefined;
    let previousRecordingStatus: RecordingState['status'] | null = null;
    const offState = api.onRecordingState(next => {
      setState(next);
      if (next.status === 'recording' && previousRecordingStatus !== 'recording') setPanel(null);
      previousRecordingStatus = next.status;
      const nextError = next.status === 'error' ? next.error : undefined;
      if (nextError && nextError !== previousError) { countdownAbort.current?.abort(); setError(nextError); }
      previousError = nextError;
    });
    const offCameraEnabled = api.onCameraEnabledChange(enabled => {
      if (!enabled) countdownAbort.current?.abort();
      cameraRef.current.onEnabledChange(enabled);
    });
    const offCameraEffects = api.onCameraEffectsChange(effects => {
      setCameraEffects(effects); remember({ cameraEffects: effects });
    });
    const offActivate = api.onActivate(() => {
      setActivationRevision(value => value + 1);
      // Returning to an active session must not reset an open menu or its devices.
      if (microphoneAvailability.current.busy) return;
      const current = sourceSelection.current;
      setPanel(current.mode === 'window' && !current.sourceId ? 'sources' : null);
      setDismissedMissingSource(''); void refreshSources();
      if (microphoneAvailability.current.microphone && !microphoneAvailability.current.busy) void refreshMicrophones();
      setCameraEffects(readAppPreferences().recording.cameraEffects);
      void cameraRef.current.activate();
    });
    return () => { offState(); offActivate(); offCameraEnabled(); offCameraEffects(); sourceRequest.current++; countdownAbort.current?.abort(); };
  }, [refreshSources, refreshMicrophones, remember]);
  useEffect(() => {
    if (!selected?.id) return;
    const saved = preferences.current.region;
    // Keep an out-of-bounds saved crop visible and blocked for correction, rather than recording the whole display.
    setCrop(mode === 'region' && saved?.sourceId === selected.id ? { ...saved.crop }
      : { x: 0, y: 0, width: selectedWidth, height: selectedHeight });
  }, [selected?.id, selectedWidth, selectedHeight, mode]);
  useEffect(() => {
    if (microphone) void refreshMicrophones();
    return () => { microphoneRequest.current++; };
  }, [microphone, refreshMicrophones]);
  useEffect(() => {
    if (!microphone || busy) return;
    const changed = () => { void refreshMicrophones(); };
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', changed);
  }, [microphone, busy, refreshMicrophones]);
  useEffect(() => {
    void window.recorder?.setExpanded(panel === 'permissions' ? false : !!panel || !!displayedError || !!outputError).catch(() => undefined);
  }, [panel, displayedError, outputError, activationRevision]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (countdownAbort.current) countdownAbort.current.abort();
      else if (!busy || panel === 'applications' || panel === 'more') { setPanel(null); clearError(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [busy, clearError, panel]);

  const start = async () => {
    if (starting.current) return;
    if (canConfigurePermissions) {
      if (panel === 'permissions' && !inputNeedsConfirmation) {
        void window.platformPermissions?.openSettings?.(permissions.guide ?? permissions.unresolved[0] ?? 'input').catch(cause => setError(errorMessage(cause)));
      }
      setPanel('permissions'); return;
    }
    if (canConfigureMicrophone) { setPanel('microphone'); return; }
    if (!window.recorder || !selected || !canStart) return;
    starting.current = true;
    const abort = new AbortController(); countdownAbort.current = abort;
    const cameraId = cameraRef.current.enabled ? cameraRef.current.sessionId() : undefined;
    setError(undefined); setPanel(null);
    try {
      if (cameraRef.current.enabled && !cameraId) throw new Error('请等待摄像头准备完成');
      for (let value = 3; value > 0; value--) {
        setCountdown(value);
        if (cameraId) await window.recorder.cameraPreviewCountdown(cameraId, value);
        await countdownTick(abort.signal);
      }
      setCountdown(null); setState({ status: 'starting' });
      if (cameraId && cameraRef.current.sessionId() !== cameraId) throw new Error('摄像头已断开，请重新连接后开始录制');
      await window.recorder.startRecording({ sourceId: selected.id, fps, resolution, systemAudio, microphone,
        ...(status?.platform === 'darwin' ? { inputRecording } : {}),
        excludedApplications: applications?.selected.map(application => application.id) ?? [],
        ...(microphone ? { microphoneEffects: microphoneSettings.effects } : {}),
        ...(microphone && microphoneDeviceId ? { microphoneDeviceId } : {}),
        ...(mode === 'region' ? { crop } : {}), ...(cameraId ? { cameraSessionId: cameraId, cameraEffects } : {}),
      });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        if (cameraId) await cameraRef.current.close(cameraId);
        cameraRef.current.activate();
        const message = errorMessage(cause); setError(message); setState({ status: 'error', error: message });
      }
    } finally {
      if (cameraId) await window.recorder.cameraPreviewCountdown(cameraId, null).catch(() => undefined);
      setCountdown(null); countdownAbort.current = null; starting.current = false;
    }
  };
  const chooseMode = (next: LauncherMode) => {
    if (busy) return;
    if (next === 'region') { void selectRegion(); return; }
    if (next !== mode) {
      setMode(next); setSourceId(next === 'window' ? '' : preferences.current.screenSourceId); setDismissedMissingSource('');
      remember({ mode: next });
    }
    setPanel(panel === 'sources' && next === mode ? null : 'sources');
  };
  const selectSource = (id: string) => {
    if (busy || !visibleSources.some(source => source.id === id)) return;
    if (mode === 'region') { void selectRegion(id); return; }
    setSourceId(id); setDismissedMissingSource('');
    if (mode !== 'window') remember({ screenSourceId: id });
  };
  const selectRegion = async (displayId?: string) => {
    if (busy) return;
    const display = sources.find(source => source.kind === 'screen' && source.id === (displayId ?? (mode === 'window' ? preferences.current.screenSourceId : selected?.id)))
      ?? sources.find(source => source.kind === 'screen');
    if (!display || !window.regionSelection) { setError('请从小录桌面版选择可用屏幕后框选'); return; }
    const previousPanel = panel;
    setSelectingRegion(true); setError(undefined); setPanel(null);
    try {
      const next = await window.regionSelection.select(display.id, mode === 'region' && selected?.id === display.id ? crop : undefined);
      if (!next) { setPanel(previousPanel); return; }
      setMode('region'); setSourceId(display.id); setCrop(next); setPanel('sources');
      remember({ mode: 'region', screenSourceId: display.id, region: { sourceId: display.id, crop: next } });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSelectingRegion(false); }
  };
  const chooseCrop = (next: Rect) => {
    setCrop(next);
    if (mode === 'region' && selected && validCrop(next, selectedWidth, selectedHeight)) {
      remember({ screenSourceId: selected.id, region: { sourceId: selected.id, crop: next } });
    }
  };
  const openEditor = async () => {
    if (busy) return;
    try { await cameraRef.current.close(); setPanel(null); setError(undefined); await window.recorder?.openEditor(); }
    catch (cause) { cameraRef.current.activate(); setError(errorMessage(cause)); }
  };
  return { status, state, sources: visibleSources, loadingSources, refreshSources, mode, chooseMode, selected, sourceId,
    selectSource, panel, setPanel,
    cameraErrorVisible: cameraNotice !== undefined && externalError === undefined && error === undefined,
    error: displayedError || outputError ? errorMessage(displayedError ?? outputError) : undefined, clearError, crop, setCrop: chooseCrop, cropValid,
    fps, setFps: (next: 30 | 60) => { setFps(next); remember({ fps: next }); },
    resolution, setResolution: (next: RecordingResolution) => { setResolution(next); remember({ resolution: next }); }, output, outputError,
    systemAudio, setSystemAudio: (next: boolean) => { setSystemAudio(next); remember({ systemAudio: next }); },
    microphone, setMicrophone: (next: boolean) => { setMicrophone(next); remember({ microphoneEnabled: next }); },
    microphoneDeviceId, setMicrophoneDeviceId: chooseMicrophoneDevice,
    microphoneEffects: microphoneSettings.effects, setMicrophoneEffects: microphoneSettings.setEffects,
    microphones, loadingMicrophones, refreshMicrophones,
    microphoneError: microphoneError ?? (microphoneMissing ? '所选麦克风已断开，请重新选择' : !loadingMicrophones && !microphones.length ? '未发现麦克风，请连接后刷新' : undefined),
    camera, cameraEffects, setCameraEffects: (next: CameraEffects, patch?: Partial<CameraEffects>) => {
      setCameraEffects(next); remember({ cameraEffects: patch ?? next });
    },
    permissions, canConfigurePermissions,
    ...operationRecording,
    countdown, cancelCountdown: () => countdownAbort.current?.abort(), busy, canStart, canConfigureMicrophone, start, openEditor,
  };
}

export type RecorderLauncherModel = ReturnType<typeof useRecorderLauncher>;
