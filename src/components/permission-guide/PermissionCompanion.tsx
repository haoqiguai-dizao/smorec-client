import { HelpCircle, LoaderCircle, X } from 'lucide-react';
import { usePermissionCompanion } from '../../hooks/usePermissionCompanion';
import { PERMISSION_NAMES } from '../../services/capture-permissions';
import { PermissionComponentStrip } from './PermissionComponentStrip';

export function PermissionCompanion() {
  const m = usePermissionCompanion();
  const disabled = m.context?.inputDisabled;
  const c = m.components;
  const restricted = m.item?.access === 'restricted';
  const waiting = c.items.length > 0 && c.items.every(item => c.attempted.includes(item.id));
  const hint = disabled ? '自动镜头已关闭' : m.error ? m.error : restricted ? '这项权限受系统限制'
    : m.pending ? '正在打开授权设置' : c.draggable ? waiting ? `打开${c.items[0]?.name ?? '小录'}右侧开关` : '把整条组件拖到上方列表'
      : '在系统提示或设置中允许' + PERMISSION_NAMES[m.kind];
  return <main className="permission-companion" aria-label="小录授权引导">
    <section className="permission-companion-body">
      {disabled ? <div className="permission-companion-choice">
        <button type="button" onClick={() => m.action('enable-input')}>启用自动镜头</button>
        <button type="button" onClick={() => m.action('skip-input')}>本次跳过</button>
      </div> : c.draggable && !restricted && c.items.filter(item => !c.attempted.includes(item.id)
        && (!m.context?.startup || !m.context.component || item.id === m.context.component)).map(item =>
        <PermissionComponentStrip key={item.id} item={item} multiple={c.items.length > 1} disabled={m.pending}
          drag={c.drag} />)}
    </section>
    <footer className="permission-companion-edge">
      <p role={m.error ? 'alert' : 'status'} title={m.error || `${m.progress} · ${PERMISSION_NAMES[m.kind]}：列表已有小录时直接打开开关，授权后自动继续。`}>
        {m.pending && <LoaderCircle size={13} className="permission-spinning" />}{hint}
      </p>
      {!disabled && c.draggable && c.attempted.length > 0 && <button className="permission-retry" type="button" onClick={c.retry}>重试</button>}
      {!disabled && !restricted && <button className="permission-request" type="button" disabled={m.pending} onClick={() => void m.request()}>{m.context?.startup ? '打开设置' : '设置授权'}</button>}
      <button className="permission-edge-tool" type="button" aria-label="授权帮助" onClick={m.help}><HelpCircle size={16} /></button>
      <button className="permission-edge-tool" type="button" aria-label="关闭授权引导" onClick={() => m.action('close')}><X size={16} /></button>
    </footer>
  </main>;
}
