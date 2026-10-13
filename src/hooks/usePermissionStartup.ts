import { useCallback, useEffect, useState } from 'react';
import { MAC_PERMISSIONS, type MacPermission } from '../../shared/platform-permissions';
import '../../shared/permission-startup';
import '../../shared/permission-guide';
import { useMacPermissions } from './useMacPermissions';
import { usePermissionComponents } from './usePermissionComponents';

export function usePermissionStartup() {
  const permissions = useMacPermissions(true);
  const [selected, setSelected] = useState<{ kind: MacPermission; granted: boolean }>();
  const kind: MacPermission = selected?.kind ?? MAC_PERMISSIONS.find(value => !permissions.status?.find(item => item.kind === value)?.granted) ?? 'screen';
  const granted = permissions.status?.some(item => item.kind === kind && item.granted) === true;
  const components = usePermissionComponents(kind, permissions.status);
  const [requested, setRequested] = useState<string[]>([]);
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (selected && !selected.granted && granted && !working) setSelected(undefined);
  }, [selected, granted, working]);
  const complete = permissions.status !== null && MAC_PERMISSIONS.every(value => permissions.status?.some(item => item.kind === value && item.granted));
  const component = components.items.find(item => !item.granted);
  const step = `${kind}:${component?.id ?? ''}`;
  const showGuide = useCallback(async () => {
    if (!['screen', 'input', 'accessibility'].includes(kind)) return window.permissionGuide?.dismiss();
    await window.permissionGuide?.show({ kind, needs: [kind], mode: 'record', inputDisabled: false, startup: true, component: component?.id });
  }, [kind, component?.id]);
  useEffect(() => {
    // Reading permissions can close the previous step, but only a click can open a guide.
    void window.permissionGuide?.dismiss().catch(cause => setError(String(cause)));
  }, [step, complete]);
  useEffect(() => () => { void window.permissionGuide?.dismiss().catch(() => {}); }, []);
  const request = async () => {
    if (working) return;
    setWorking(true); setError('');
    try {
      if (!window.platformPermissions) throw new Error('系统授权服务暂不可用');
      await showGuide();
      if (granted || requested.includes(step)) await window.platformPermissions.openSettings?.(kind);
      else {
        setRequested(values => [...values, step]);
        await window.platformPermissions.request(kind, kind === 'screen' ? component?.id : undefined);
      }
      await permissions.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '授权设置未能打开'); }
    finally { setWorking(false); }
  };
  const select = (value: MacPermission) => {
    if (working) return;
    setError('');
    setSelected({ kind: value, granted: permissions.status?.some(item => item.kind === value && item.granted) === true });
  };
  const enter = async () => {
    setWorking(true); setError('');
    try { await window.permissionStartup?.enter(); }
    catch (cause) { setError(String(cause)); await permissions.refresh(); setWorking(false); }
  };
  return { ...permissions, kind, components, component, granted, requested: requested.includes(step), complete, working,
    issue: error || permissions.error || components.error, request, enter, select };
}
