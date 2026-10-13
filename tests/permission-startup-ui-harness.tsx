import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PermissionStartup } from '../src/components/permission-guide/PermissionStartup';
import { MAC_PERMISSIONS, type MacPermission, type PermissionComponentId } from '../shared/platform-permissions';
import '../src/styles/permission-companion.css';
import '../src/styles/permission-startup.css';

let requests: string[] = [], settings: string[] = [], entered = 0;
let companion = '', shows = 0, delayed = false;
const allowed = new Set<MacPermission>(), screen = new Set<PermissionComponentId>();
function receipt() {
  document.getElementById('receipt')!.textContent = `请求 ${requests.length} · 设置 ${settings.length} · 进入 ${entered} · 显示 ${shows} · 组件 ${companion || '收起'} · 请求项 ${requests.join(',')} · 设置项 ${settings.join(',')}`;
}
window.platformPermissions = {
  get: async () => MAC_PERMISSIONS.map(kind => ({ kind, granted: allowed.has(kind), access: allowed.has(kind) ? 'granted' : 'not-granted' })),
  request: async (kind, component) => { requests.push(kind + (component ? ':' + component : '')); receipt(); },
  openSettings: async kind => { settings.push(kind); receipt(); },
  components: async kind => { if (delayed) await new Promise(resolve => setTimeout(resolve, 1200)); return kind === 'screen' ? [
    { id: 'application', name: '小录', role: '主应用', granted: screen.has('application') },
    { id: 'capture', name: '小录采集', role: '录制组件', granted: screen.has('capture') },
  ] : [{ id: kind === 'camera' ? 'application' : 'capture', name: kind === 'camera' ? '小录' : '小录采集', role: '录制组件', granted: allowed.has(kind) }]; },
  dragComponent: () => {}, revealComponent: async () => {},
};
window.permissionStartup = { enter: async () => { entered++; receipt(); }, quit: async () => {} };
const none = () => () => {};
window.permissionGuide = {
  show: async context => { shows++; companion = context.kind + ':' + context.component; receipt(); }, dismiss: async () => { companion = ''; receipt(); },
  context: async () => null, action: async () => {}, step: async () => {}, help: async () => {},
  onContext: none, onAction: none, onHelpAction: none,
};
document.getElementById('grant')!.addEventListener('click', () => {
  const kind = MAC_PERMISSIONS.find(value => !allowed.has(value));
  if (kind === 'screen') { screen.add(screen.has('application') ? 'capture' : 'application'); if (screen.size === 2) allowed.add(kind); }
  else if (kind) allowed.add(kind);
  window.dispatchEvent(new Event('focus')); receipt();
});
document.getElementById('reset')!.addEventListener('click', () => {
  allowed.clear(); screen.clear(); requests = []; settings = []; entered = 0; shows = 0;
  window.dispatchEvent(new Event('focus')); receipt();
});
for (const kind of ['input', 'accessibility'] as const) document.getElementById(`grant-${kind}`)!.onclick = () => { allowed.add(kind); window.dispatchEvent(new Event('focus')); receipt(); };
document.getElementById('delay')!.onclick = () => { delayed = !delayed; document.getElementById('delay')!.textContent = delayed ? '取消组件延迟' : '延迟组件响应'; };
const holder = document.getElementById('root')!;
holder.style.width = '680px'; holder.style.height = '620px';
holder.style.margin = '30px auto'; holder.style.border = '1px solid #ffffff14'; holder.style.borderRadius = '20px';
createRoot(holder).render(<StrictMode><PermissionStartup /></StrictMode>);
receipt();
