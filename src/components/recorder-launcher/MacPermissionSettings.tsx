import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Info, ShieldCheck } from 'lucide-react';
import { MAC_PERMISSIONS, type MacPermission } from '../../../shared/platform-permissions';
import { useMacPermissions } from '../../hooks/useMacPermissions';
import type { CapturePermissions } from '../../hooks/useCapturePermissions';
import { PERMISSION_NAMES, capturePermissionState, permissionAccessLabel } from '../../services/capture-permissions';

export function MacPermissionSettings({ disabled, permissions, onGuide }: { disabled: boolean; permissions?: CapturePermissions; onGuide?(kind: MacPermission): void }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId(), section = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (expanded) section.current?.scrollIntoView({ block: 'nearest' }); }, [expanded]);
  const own = useMacPermissions(expanded, !permissions);
  const { status, error, pending, loading, request, refresh } = permissions ?? own;
  const needs: MacPermission[] = permissions?.needs ?? ['screen'];
  const optional = MAC_PERMISSIONS.filter(kind => !needs.includes(kind));
  const grantedCount = status?.filter(item => item.granted).length ?? 0;
  const ready = capturePermissionState(needs, status).ready && !error && !loading;
  const row = (kind: MacPermission) => {
    const item = status?.find(value => value.kind === kind);
    return <div className="mac-permission-row" key={kind}>
      <span>{PERMISSION_NAMES[kind]}</span>
      {item?.granted ? <span className="mac-permission-granted"><Check size={13} />已允许</span>
        : item && item.access !== 'restricted' ? <button type="button" className="launcher-icon" disabled={disabled || pending !== null}
          onClick={() => onGuide ? onGuide(kind) : void request(kind)} aria-label={`设置${PERMISSION_NAMES[kind]}权限`}>{pending === kind ? '正在打开' : '设置授权'}</button>
          : <span className="mac-permission-unknown">{permissionAccessLabel(item)}</span>}
    </div>;
  };
  return <section ref={section} className="mac-permissions" data-no-drag="true" aria-label="当前任务权限">
    <button type="button" className={`launcher-menu-row mac-permissions-toggle${ready ? ' mac-permissions-ready' : ''}`} aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}>
      {ready ? <Check size={16} /> : <ShieldCheck size={16} />}<span>{error ? '权限读取失败' : loading ? '正在检查权限' : `系统授权 ${grantedCount}/${MAC_PERMISSIONS.length}`}</span>
      <ChevronDown size={16} className={expanded ? 'expanded' : undefined} aria-hidden="true" />
    </button>
    <div id={id} hidden={!expanded} className="mac-permissions-content">
      <div className="mac-permissions-toolbar"><span tabIndex={0} role="img" aria-label="系统权限说明" title="按当前使用的设备和功能检查；操作记录需要输入监控和辅助功能，供点击高亮与自动镜头使用。返回小录后自动检查。"><Info size={14} /></span>
        <button type="button" className="mac-permissions-refresh" disabled={loading || pending !== null} onClick={() => void refresh()}>重新检查</button></div>
      {!status && loading && <div className="mac-permissions-loading" role="status">正在读取权限…</div>}
      {needs.map(row)}
      {!!optional.length && <div className="mac-permissions-optional"><span className="mac-permissions-unused">当前未启用的功能</span>{optional.map(row)}</div>}
      {error && <div className="launcher-inline-error" role="alert">{error}</div>}
    </div>
  </section>;
}
