import { useEffect, useState } from 'react';
import type { MacPermission, PermissionComponent, PermissionComponentId, PermissionStatus } from '../../shared/platform-permissions';

export function usePermissionComponents(kind: MacPermission, status?: PermissionStatus[] | null) {
  const [snapshot, setSnapshot] = useState<{ kind: MacPermission; items: PermissionComponent[] }>();
  const items = snapshot?.kind === kind ? snapshot.items : [];
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState<PermissionComponentId[]>([]);
  useEffect(() => {
    setError(''); setAttempted([]);
    const api = window.platformPermissions;
    const off = api?.onComponentError?.(message => { setError(message); setAttempted([]); });
    return () => off?.();
  }, [kind]);
  useEffect(() => {
    let current = true;
    const api = window.platformPermissions;
    void api?.components?.(kind).then(next => { if (current) {
      // One missing component at a time; a drag is only an attempt, not a grant.
      setSnapshot({ kind, items: next.filter(item => item.granted !== true).slice(0, 1) });
      if (!next.length && ['screen', 'input', 'accessibility'].includes(kind)) setError('当前安装中没有对应授权组件，请重新安装小录');
    } })
      .catch(() => { if (current) setError('无法读取授权组件，请重新检查'); });
    return () => { current = false; };
  }, [kind, status]);
  const reveal = (id: PermissionComponentId) => {
    setError('');
    void window.platformPermissions?.revealComponent?.(kind, id).catch(() => setError('无法定位小录，请重新检查'));
  };
  return { items, error, reveal, attempted, draggable: ['screen', 'input', 'accessibility'].includes(kind),
    retry: () => { setAttempted([]); setError(''); },
    drag: (id: PermissionComponentId) => {
      if (!items.some(item => item.id === id)) return;
      setError('');
      const api = window.platformPermissions;
      if (!api?.dragComponent) { setError('拖拽暂不可用，请通过帮助在访达中找到小录'); return; }
      // A drag attempt collapses its source. Only fresh permission status can finish the step.
      api.dragComponent(kind, id);
      setAttempted(previous => previous.includes(id) ? previous : [...previous, id]);
    } };
}
