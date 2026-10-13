import { useCallback, useEffect, useRef, useState } from 'react';
import type { MicrophoneDevice } from '../../shared/types';

export function useMicrophoneDevices(enabled: boolean, selectedId: string) {
  const [devices, setDevices] = useState<MicrophoneDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const currentRequest = ++request.current;
    setLoading(true); setError(undefined);
    try {
      if (!window.studio) throw new Error('请使用小录桌面版选择麦克风');
      const next = await window.studio.getMicrophones();
      if (currentRequest === request.current) setDevices(next);
    } catch (cause) { if (currentRequest === request.current) setError(cause instanceof Error ? cause.message : '无法读取麦克风设备'); }
    finally { if (currentRequest === request.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (enabled) void refresh();
    return () => { request.current++; };
  }, [enabled, refresh]);
  const selectionMissing = enabled && !loading && !!selectedId && !devices.some(device => device.id === selectedId);
  const deviceError = error ?? (selectionMissing ? '所选麦克风已断开，请重新选择' : enabled && !loading && !devices.length ? '未发现麦克风，请连接后刷新' : undefined);
  return { devices, loading, error: deviceError, refresh, ready: !enabled || (!loading && !deviceError) };
}
