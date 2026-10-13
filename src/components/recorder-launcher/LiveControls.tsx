import { shortcutLabel } from '../../../shared/shortcut-label';
import { Focus, Info, LoaderCircle, Radio, RectangleHorizontal, RectangleVertical, Square, EyeOff } from 'lucide-react';
import type { LiveSessionModel } from '../../hooks/useLiveSession';
import { StreamSettings } from './StreamSettings';
import { StreamAudioSettings } from './StreamAudioSettings';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import { OperationRecordingSetting } from './LauncherRecordingSettings';

export function LiveAccessories({ live, applicationsOpen, onApplications, includeApplications = true }: { live: LiveSessionModel; applicationsOpen: boolean; onApplications(): void; includeApplications?: boolean }) {
  return <>
    {includeApplications && <button type="button" className={`launcher-mode ${applicationsOpen ? 'active' : ''}`} aria-label="排除应用" aria-expanded={applicationsOpen}
      onClick={onApplications}><EyeOff size={18} /><span>排除应用</span></button>}
    <button className="launcher-mode" title="切换直播画幅" disabled={live.active} onClick={() => live.setPortrait(!live.portrait)}>
      {live.portrait ? <RectangleVertical size={18} /> : <RectangleHorizontal size={18} />}<span>{live.portrait ? '竖屏' : '横屏'}</span>
    </button>
    <button className="launcher-mode" aria-label="自动缩放" aria-pressed={live.zoomEnabled} title={live.zoomAvailable ? shortcutLabel('自动缩放 · Ctrl+Alt+Shift+Z') : '开始前启用操作记录并完成授权，即可使用自动镜头'} disabled={live.state.status !== 'live' || !live.zoomAvailable} onClick={() => live.action('toggle-auto-zoom')}><Focus size={18} /><span>{live.zoomEnabled ? '自动缩放' : '保持全景'}</span></button>
  </>;
}
export function LiveStart({ live, canStart, start, step = 1, open = start }: { live: LiveSessionModel; canStart: boolean; start(): void; step?: 1 | 2; open?(): void }) {
  const waiting = live.installing || live.connecting || live.state.status === 'starting' || live.state.status === 'stopping';
  const preview = live.state.phase === 'preview';
  return <button className="launcher-start" aria-busy={waiting} data-toolbar-focus={live.active && !preview ? 'stop' : undefined} disabled={waiting || (preview ? !live.previewReady : !live.active && step === 2 && !canStart)}
    onClick={() => live.active ? preview ? void live.broadcast() : void live.stop() : step === 2 ? start() : open()}>
    {waiting ? <LoaderCircle size={15} className="launcher-spinning" /> : live.active && !preview ? <Square size={13} /> : <Radio size={15} />}
    <span>{waiting ? '准备中' : preview ? live.output === 'stream' ? '开始推流' : '启动虚拟摄像头' : live.active ? live.output === 'stream' ? '停止推流' : '停止输出' : step === 2 ? '开始预览' : '准备直播'}</span>
  </button>;
}
export function LiveSettings({ live, audio }: { live: LiveSessionModel; audio?: RecorderLauncherModel }) {
  return <div className="launcher-live-settings">
    {audio && <OperationRecordingSetting model={audio} />}
    <label className="launcher-live-output">输出方式<select aria-label="直播输出方式" value={live.output} disabled={live.active}
      onChange={event => live.setOutput(event.target.value as 'camera' | 'stream')}><option value="camera">虚拟摄像头</option><option value="stream">直接推流 RTMP / RTMPS</option></select></label>
    {live.output === 'stream' ? <>{audio && <StreamAudioSettings model={audio} active={live.active} />}<StreamSettings model={live.profiles} active={live.active} connection={live.state.connection} /></> : <>
    <div className="launcher-live-row"><strong>小录 Virtual Camera</strong>
      <button className="launcher-icon" aria-label="直播接入说明" title="在直播伴侣添加摄像头，选择「小录 Virtual Camera」。麦克风和系统声音在直播伴侣中设置。首次安装后请重启直播伴侣。Mac 首次安装需在系统设置批准摄像头扩展。"><Info size={16} /></button>
      <span>{live.device?.installed ? '已安装' : '未安装'}</span>
      {!live.device?.installed && <button className="launcher-start" disabled={live.active || live.installing || !live.device?.available} onClick={() => void live.install()}>{live.installing ? '安装中' : '安装摄像头'}</button>}
    </div>
    {live.device && !live.device.available && <div className="launcher-inline-error">虚拟摄像头组件未就绪，请重新安装小录。</div>}
    <dl className="launcher-live-shortcuts"><dt>显示 / 隐藏操作栏</dt><dd>{shortcutLabel('Ctrl + Shift + L')}</dd><dt>结束投屏</dt><dd>{shortcutLabel('Ctrl + Shift + R')}</dd><dt>回到全景</dt><dd>{shortcutLabel('Ctrl + Shift + 0')}</dd><dt>自动缩放开关</dt><dd>{shortcutLabel('Ctrl + Alt + Shift + Z')}</dd></dl>
    </>}
  </div>;
}
