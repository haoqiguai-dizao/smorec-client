import { useCallback, useEffect, useRef, useState } from 'react';
import type { MacPermission, PermissionStatus, PermissionComponentId } from '../../shared/platform-permissions';

/** Status refreshes never own the disclosure state or reset the panel's scroll position. */
export function useMacPermissions(expanded: boolean, enabled = true) {
  const [status, setStatus] = useState<PermissionStatus[] | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<MacPermission | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshing = useRef<Promise<void> | null>(null);
  const requesting = useRef(false);
  const refresh = useCallback(() => {
    if (refreshing.current) return refreshing.current;
    setLoading(true);
    const request = Promise.resolve().then(async () => {
      if (!window.platformPermissions) throw new Error('系统权限服务暂不可用');
      setStatus(await window.platformPermissions.get());
      setError('');
    }).catch(error => setError(error instanceof Error ? error.message : '无法读取系统权限'))
      .finally(() => { refreshing.current = null; setLoading(false); });
    refreshing.current = request;
    return request;
  }, []);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const visibleRefresh = () => { if (!document.hidden) void refresh(); };
    visibleRefresh(); window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    const timer = expanded ? window.setInterval(visibleRefresh, 2500) : undefined;
    return () => {
      window.removeEventListener('focus', visibleRefresh);
      document.removeEventListener('visibilitychange', visibleRefresh);
      window.clearInterval(timer);
    };
  }, [refresh, expanded, enabled]);
  const request = async (kind: MacPermission, settings = false, component?: PermissionComponentId) => {
    if (requesting.current) return;
    requesting.current = true; setPending(kind); setError('');
    try {
      if (!window.platformPermissions) throw new Error('系统权限服务暂不可用');
      if (settings && window.platformPermissions.openSettings) await window.platformPermissions.openSettings(kind);
      else await window.platformPermissions.request(kind, component);
      await refreshing.current;
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : '无法打开系统权限设置'); }
    finally { requesting.current = false; setPending(null); }
  };
  return { status, error, pending, loading, request, refresh };
}
