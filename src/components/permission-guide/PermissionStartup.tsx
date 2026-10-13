import { Check, ChevronRight, HelpCircle, Keyboard, LoaderCircle, Mic, Monitor, MousePointer2, RefreshCw, Video } from 'lucide-react';
import { MAC_PERMISSIONS } from '../../../shared/platform-permissions';
import { usePermissionStartup } from '../../hooks/usePermissionStartup';
import { PERMISSION_NAMES } from '../../services/capture-permissions';
import icon from '../../../sites/website/assets/xiaolu-icon.png';

const features = { screen: '录制屏幕与系统声音', camera: '拍摄人物画面', microphone: '录制你的声音', input: '识别点击与输入活动', accessibility: '让自动镜头跟随操作' };
const icons = { screen: Monitor, camera: Video, microphone: Mic, input: Keyboard, accessibility: MousePointer2 };
export function PermissionStartup() {
  const m = usePermissionStartup();
  const count = m.status?.filter(item => item.granted).length ?? 0;
  const disabled = m.working || m.loading && !m.status || !!m.error || !m.complete && !m.granted && m.components.draggable && !m.component;
  return <main className="permission-startup" aria-label="小录启动授权">
    <header><img src={icon} alt="小录" /><div><h1>准备好，再开始</h1><p>完成系统授权后进入小录</p></div><span>{count} / 5</span></header>
    <section className="permission-startup-list" aria-label="系统权限">
      {MAC_PERMISSIONS.map(kind => {
        const granted = m.status?.find(item => item.kind === kind)?.granted, Icon = icons[kind];
        return <button type="button" key={kind} aria-label={`选择${PERMISSION_NAMES[kind]}权限`} aria-pressed={!m.complete && m.kind === kind}
          disabled={m.working} onClick={() => m.select(kind)} className={`permission-startup-row ${!m.complete && m.kind === kind ? 'current' : ''}`}>
          <Icon size={20} /><div><strong>{PERMISSION_NAMES[kind]}</strong><span>{features[kind]}</span></div>
          {granted ? <span className="permission-startup-granted"><Check size={15} />已允许</span> : m.kind === kind
            ? <span className="permission-startup-current">当前步骤</span> : <span>待授权</span>}
        </button>;
      })}
    </section>
    <section className="permission-startup-action" aria-live="polite">
      {m.complete ? <p className="permission-startup-ready"><Check size={17} />已准备就绪</p> : <>
        <div className="permission-startup-caption"><strong>{PERMISSION_NAMES[m.kind]}{m.component ? ` · ${m.component.name}` : ''}</strong>
          <span title={`系统列表已有同名组件时打开开关；没有时把系统设置下方的组件拖入列表，或用系统的“＋”添加。小录采集在系统中也可能显示为 XiaoLu.Capture。${m.kind === 'accessibility' ? '部分新版 macOS 将本页称为“设备控制和数据访问”。' : ''}授权以实际检测结果为准。`}><HelpCircle size={15} /></span></div>
        <p>{m.granted ? '已允许，可查看这一项的系统设置' : m.requested ? '在系统提示或设置中允许，返回后会自动检测' : '点击下方按钮，只请求当前这一项'}</p>
        {m.requested && m.components.draggable && <p>授权组件显示在系统设置下方</p>}
      </>}
      {m.issue && <p role="alert" className="permission-startup-error">{m.issue}</p>}
    </section>
    <footer><button type="button" className="permission-startup-refresh" disabled={m.working} onClick={() => void m.refresh()}><RefreshCw size={14} />重新检测</button>
      <button type="button" className="permission-startup-primary" disabled={disabled} onClick={() => void (m.complete ? m.enter() : m.request())}>
        {m.working ? <LoaderCircle size={16} className="permission-spinning" /> : null}{m.complete ? '进入小录' : m.granted || m.requested ? '打开系统设置' : '开始授权'}<ChevronRight size={16} />
      </button></footer>
  </main>;
}
