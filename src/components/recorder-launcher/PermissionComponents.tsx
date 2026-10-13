import { FolderOpen, GripVertical } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MacPermission, PermissionComponent } from '../../../shared/platform-permissions';

/** Cards refer to the running installation; they never export a copied or older helper. */
export function PermissionComponents({ kind, disabled }: { kind: MacPermission; disabled: boolean }) {
  const [items, setItems] = useState<PermissionComponent[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setItems([]); setError('');
    const api = window.platformPermissions;
    void api?.components?.(kind).then(next => { if (current) setItems(next); })
      .catch(() => { if (current) setError('无法读取授权组件，请重新检查'); });
    const off = api?.onComponentError?.(message => { if (current) setError(message); });
    return () => { current = false; off?.(); };
  }, [kind]);
  if (!items.length && !error) return null;
  const draggable = ['screen', 'input', 'accessibility'].includes(kind);
  return <div className="permission-components">
    {items.map(item => <div key={item.id} className="permission-component" draggable={draggable && !disabled}
      aria-label={`${item.name} ${item.role}${draggable ? '，可拖入系统权限列表' : ''}`}
      onDragStart={event => { event.preventDefault(); if (!disabled) window.platformPermissions?.dragComponent?.(kind, item.id); }}>
      <GripVertical size={18} aria-hidden="true" /><span><strong>{item.name}</strong><small>{item.role}</small></span>
      <button type="button" aria-label={`定位${item.role}`} title="在访达中定位，方便使用系统设置的＋添加" disabled={disabled}
        onClick={() => { setError(''); void window.platformPermissions?.revealComponent?.(kind, item.id).catch(() => setError('无法定位组件，请重新检查')); }}><FolderOpen size={17} /></button>
    </div>)}
    {draggable && !!items.length && <p className="permission-guide-note">拖入权限列表，再开启开关；不支持拖入时使用“＋”。</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
