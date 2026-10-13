import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraAcquisition, cameraConnectionCanceled, type CameraConnectionPhase } from '../services/camera-acquisition';
import { useCameraPreviewSender } from './useCameraPreviewSender';
import { readRecordingDevicePreference, saveRecordingDevicePreference } from '../services/recording-device-preferences';
import { readAppPreferences, updateAppPreferences } from '../services/app-preferences';
import { cameraActualFormat, normalizeCameraFormat, type CameraActualFormat, type CameraFormatPreference } from '../services/camera-format';
import { readCameraFormatPreference, saveCameraFormatPreference } from '../services/camera-format-preferences';
import { VIRTUAL_CAMERA_NAME } from '../../shared/live-types';
import { cameraError } from '../services/camera-errors';
import { cameraErrorContext } from '../services/camera-error-context';

export function useWebcam(reportError: (message: string | undefined) => void) {
  // Intent survives temporary release, recording completion, editor navigation and unmount.
  const [enabled, setEnabled] = useState(() => readAppPreferences().recording.cameraEnabled);
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const [stream, setStream] = useState<MediaStream | null>(null);
  useCameraPreviewSender(stream);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => readRecordingDevicePreference('camera'));
  const deviceRef = useRef(selectedDeviceId); deviceRef.current = selectedDeviceId;
  const [format, setFormat] = useState(() => readCameraFormatPreference(selectedDeviceId));
  const formatRef = useRef(format); formatRef.current = format;
  const [actualFormat, setActualFormat] = useState<CameraActualFormat>();
  const recording = useRef(false);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<CameraConnectionPhase>();
  const [error, setError] = useState<string>();
  const owner = useRef<CameraAcquisition | null>(null);
  if (!owner.current) owner.current = new CameraAcquisition({ api: () => window.recorder ?? window.studio,
    media: async constraints => {
      const source = await navigator.mediaDevices.getUserMedia(constraints);
      if (source.getVideoTracks().some(track => track.label === VIRTUAL_CAMERA_NAME)) {
        source.getTracks().forEach(track => track.stop());
        throw new Error('小录虚拟摄像头用于向外输出，请选择其他摄像头或关闭人物画面');
      }
      return source;
    } });
  const acquisition = owner.current;
  const mounted = useRef(false), activated = useRef(false), revision = useRef(0), enumeration = useRef(0);
  const inputRevision = useRef(0), replacingInput = useRef(false);
  const reportRef = useRef(reportError); reportRef.current = reportError;
  const describeFailure = useCallback((reason: unknown, current: number) => {
    const message = cameraError(reason); setError(message); reportRef.current(message);
    void cameraErrorContext(reason).then(refined => {
      if (mounted.current && revision.current === current) { setError(refined); reportRef.current(refined); }
    });
  }, []);

  const refresh = useCallback(async () => {
    const request = ++enumeration.current;
    const list = await navigator.mediaDevices.enumerateDevices();
    if (mounted.current && request === enumeration.current) setDevices(list.filter(device => device.kind === 'videoinput' && device.label !== VIRTUAL_CAMERA_NAME));
  }, []);
  const close = useCallback(async (expectedSessionId?: string) => {
    if (expectedSessionId && !acquisition.owns(expectedSessionId)) return;
    recording.current = false;
    revision.current++;
    if (mounted.current) { setStream(null); setLoading(false); setPhase(undefined); setError(undefined); reportRef.current(undefined); }
    await acquisition.release(expectedSessionId);
  }, [acquisition]);
  const connect = useCallback(async (deviceId: string, requestedFormat = formatRef.current) => {
    const current = ++revision.current;
    setLoading(true); setPhase('preparing'); setError(undefined); reportRef.current(undefined); setStream(null);
    try {
      const active = await acquisition.connect(deviceId, reason => {
        if (!mounted.current || current !== revision.current) return;
        recording.current = false;
        revision.current++;
        setStream(null); setLoading(false); setPhase(undefined);
        describeFailure(reason, revision.current);
        void acquisition.release();
      }, next => {
        if (mounted.current && current === revision.current) {
          setPhase(next);
          if (next === 'device') void refresh().catch(() => undefined);
        }
      }, requestedFormat);
      if (!mounted.current || current !== revision.current) return;
      const openedDeviceId = (active.sourceStream ?? active.stream).getVideoTracks()[0]?.getSettings().deviceId || deviceId;
      setStream(active.stream); setSelectedDeviceId(openedDeviceId); deviceRef.current = openedDeviceId;
      if (openedDeviceId) saveRecordingDevicePreference('camera', openedDeviceId);
      saveCameraFormatPreference(openedDeviceId, requestedFormat);
      return active;
    } catch (reason) {
      if (mounted.current && current === revision.current && !cameraConnectionCanceled(reason)) {
        describeFailure(reason, current);
      }
    } finally {
      if (mounted.current && current === revision.current) {
        setLoading(false); setPhase(undefined);
        void refresh().catch(() => undefined);
      }
    }
  }, [acquisition, describeFailure, refresh]);
  const replaceRecordingInput = useCallback(async (id: string, next = readCameraFormatPreference(id)) => {
    if (replacingInput.current) return;
    replacingInput.current = true;
    const current = ++inputRevision.current, ownerRevision = revision.current;
    const valid = () => mounted.current && revision.current === ownerRevision && inputRevision.current === current;
    setLoading(true); setPhase('device'); setError(undefined); reportRef.current(undefined);
    try {
      const active = await acquisition.replace(id, next);
      if (!valid()) return;
      const actual = active.sourceStream ?? active.stream;
      const selected = actual.getVideoTracks()[0]?.getSettings().deviceId || id;
      setStream(active.stream); setSelectedDeviceId(selected); deviceRef.current = selected;
      formatRef.current = next; setFormat(next); setActualFormat(cameraActualFormat(actual.getVideoTracks()[0]));
      saveRecordingDevicePreference('camera', selected); saveCameraFormatPreference(selected, next);
    } catch (reason) {
      if (valid()) {
        const kept = acquisition.current()?.sourceStream?.getVideoTracks().some(track => track.readyState === 'live');
        const message = `摄像头切换失败，${kept ? '原摄像头继续录制' : '屏幕录制继续'}：${cameraError(reason)}`;
        setError(message); reportRef.current(message);
      }
    }
    finally { replacingInput.current = false; if (valid()) { setLoading(false); setPhase(undefined); } }
  }, [acquisition, describeFailure]);
  const activate = useCallback(() => {
    // The launcher calls this only after its ready handshake and command subscriptions are installed.
    activated.current = true;
    void refresh().catch(() => undefined);
    const current = acquisition.current();
    if (enabledRef.current && (!acquisition.pending() || current && !current.stream.getVideoTracks().some(track => track.readyState === 'live'))) {
      void connect(deviceRef.current);
    }
  }, [acquisition, connect, refresh]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = (window.recorder ?? window.studio)?.onCameraCommand(async command => {
      const active = acquisition.current();
      if (!active || active.id !== command.id) return;
      try {
        if (command.action === 'start') { recording.current = true; await active.start(); }
        else {
          if (command.action === 'stop') await active.finish(); else await active.cancel(false);
          if (acquisition.completed(active) && mounted.current) {
            recording.current = false;
            revision.current++; setStream(null); setLoading(false); setPhase(undefined);
          }
        }
      } catch (reason) {
        recording.current = false;
        if (acquisition.current() === active && mounted.current) {
          const closing = close(active.id), current = revision.current;
          await closing;
          if (mounted.current && current === revision.current) {
            const message = cameraError(reason); setError(message); reportRef.current(message);
          }
        }
      }
    });
    return () => {
      mounted.current = false; activated.current = false; revision.current++; enumeration.current++;
      unsubscribe?.(); void acquisition.release();
    };
  }, [acquisition, close]);
  useEffect(() => {
    const changed = () => { void refresh().catch(() => undefined); };
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', changed);
  }, [refresh]);
  useEffect(() => {
    const update = () => {
      const next = cameraActualFormat((acquisition.current()?.sourceStream ?? stream)?.getVideoTracks()[0]);
      setActualFormat(previous => previous?.width === next?.width && previous?.height === next?.height && previous?.fps === next?.fps ? previous : next);
    };
    update();
    if (!stream) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [stream, acquisition]);

  const availableDevices = selectedDeviceId && !devices.some(device => device.deviceId === selectedDeviceId)
    ? [{ deviceId: selectedDeviceId, label: error ? '所选摄像头（不可用）' : stream ? '当前摄像头' : '上次选择的摄像头（未连接）' }, ...devices]
    : devices;
  return { enabled, stream, sourceStream: acquisition.current()?.sourceStream ?? stream,
    devices: availableDevices, selectedDeviceId, loading, phase, error, close, activate, format, actualFormat,
    startWhileRecording: async () => {
      const active = acquisition.current() ?? await connect(deviceRef.current);
      if (!active) throw new Error('摄像头连接失败，请检查设备后重试');
      if (!window.recorder?.attachRecordingCamera) throw new Error('请从录制栏开启摄像头');
      await window.recorder.attachRecordingCamera(active.id);
      enabledRef.current = true; setEnabled(true); updateAppPreferences({ recording: { cameraEnabled: true } });
    },
    sessionId: () => acquisition.current()?.id,
    onEnabledChange: (value: boolean) => {
      enabledRef.current = value; setEnabled(value);
      updateAppPreferences({ recording: { cameraEnabled: value } });
      if (!value) void close(); else if (activated.current) void connect(deviceRef.current);
    },
    onDeviceChange: (id: string) => {
      if (recording.current) { void replaceRecordingInput(id); return; }
      const next = readCameraFormatPreference(id); formatRef.current = next; setFormat(next);
      deviceRef.current = id; setSelectedDeviceId(id); saveRecordingDevicePreference('camera', id);
      if (enabledRef.current && activated.current) void connect(id, next);
    },
    onFormatChange: (value: CameraFormatPreference) => {
      if (recording.current) { void replaceRecordingInput(deviceRef.current, normalizeCameraFormat(value)); return; }
      const next = normalizeCameraFormat(value); formatRef.current = next; setFormat(next);
      saveCameraFormatPreference(deviceRef.current, next);
      if (enabledRef.current && activated.current) void connect(deviceRef.current, next);
    },
    onRefresh: () => {
      if (recording.current) { void refresh().catch(() => {}); void replaceRecordingInput(deviceRef.current); return; }
      void refresh().catch(reason => { if (mounted.current) setError(cameraError(reason)); });
      if (enabledRef.current && activated.current) void connect(deviceRef.current);
    },
  };
}
