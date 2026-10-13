import { useCallback, useEffect, useRef, useState } from 'react';
import type { PermissionGuideAction, PermissionGuideContext } from '../../shared/permission-guide';
import type { MacPermission } from '../../shared/platform-permissions';
import { useMacPermissions } from './useMacPermissions';
import { usePermissionComponents } from './usePermissionComponents';

export function usePermissionCompanion() {
  const [context, setContext] = useState<PermissionGuideContext | null>(null);
  const [kind, setKind] = useState<MacPermission>('screen');
  const [steps, setSteps] = useState<MacPermission[]>([]);
  const [error, setError] = useState('');
  const permissions = useMacPermissions(true);
  const components = usePermissionComponents(kind, permissions.status);
  const closing = useRef(false), opened = useRef(new Set<string>());
  const component = kind === 'screen' ? context?.component ?? components.items[0]?.id : undefined;
  const step = `${kind}:${component ?? ''}`;
  const contextKey = useRef('');
  const action = useCallback((value: PermissionGuideAction) => {
    if (closing.current) return;
    closing.current = true;
    void window.permissionGuide?.action(value).catch(cause => { closing.current = false; setError(String(cause)); });
  }, []);
  useEffect(() => {
    let current = true;
    const apply = (value: PermissionGuideContext) => { if (!current || contextKey.current === JSON.stringify(value)) return;
      contextKey.current = JSON.stringify(value);
      closing.current = false; opened.current.clear(); setContext(value); setKind(value.kind); setSteps([]); setError(''); };
    const api = window.permissionGuide;
    const off = api?.onContext(apply);
    void api?.context().then(value => { if (value) apply(value); }).catch(() => { if (current) setError('无法读取授权引导，请返回小录重试'); });
    return () => { current = false; off?.(); };
  }, []);
  const open = useCallback(async (settings = false) => {
    setError('');
    opened.current.add(step);
    await permissions.request(kind, settings, component);
  }, [kind, permissions.request, step, component]);
  useEffect(() => {
    if (!context || context.inputDisabled || permissions.loading || permissions.pending || permissions.error || !permissions.status) return;
    if (!steps.length) setSteps(context.needs.includes(context.kind)
      ? context.needs.filter(value => !permissions.status?.find(item => item.kind === value)?.granted) : [context.kind]);
    if (permissions.status.find(item => item.kind === kind)?.granted) {
      const next = context.needs.includes(context.kind) ? context.needs.find(value => !permissions.status?.find(item => item.kind === value)?.granted) : undefined;
      if (next) { setKind(next); void window.permissionGuide?.step(next).catch(cause => setError(String(cause))); }
      else action('complete');
      return;
    }
  }, [context, kind, steps.length, permissions.loading, permissions.pending, permissions.error, permissions.status, open, action]);
  useEffect(() => window.permissionGuide?.onHelpAction(value => {
    if (value === 'settings') void open(true);
    if (value === 'refresh') void permissions.refresh();
    if (value === 'reveal') components.items.forEach(item => components.reveal(item.id));
  }), [open, permissions.refresh, components]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') action('close'); };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [action]);
  return { context, kind, item: permissions.status?.find(value => value.kind === kind),
    error: error || permissions.error || components.error, components,
    progress: `${Math.max(1, steps.indexOf(kind) + 1)} / ${Math.max(1, steps.length)}`,
    pending: permissions.pending !== null || permissions.loading && !permissions.status,
    request: () => open(context?.startup || opened.current.has(step)),
    action, help: () => { void window.permissionGuide?.help().catch(cause => setError(String(cause))); } };
}
