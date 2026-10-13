import { Camera, Radio, Info } from 'lucide-react';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import type { LiveSessionModel } from '../../hooks/useLiveSession';
import { LiveConnectionSettings } from './LiveConnectionSettings';
import { LivePreviewSettings } from './LivePreviewSettings';
import './live-workflow.css';
import type { SessionDevices } from '../session-controls/types';

export function LiveWorkflow({ live, model, step, setStep, ready, start, cameraSettings, devices }: {
  live: LiveSessionModel; model: RecorderLauncherModel; step: 1 | 2; setStep(step: 1 | 2): void; ready: boolean; start(): void;
  cameraSettings?: { disabled: boolean; opening: boolean; open(): Promise<void> };
  devices?: SessionDevices;
}) {
  const active = live.active, current = active ? live.state.phase === 'broadcast' ? 3 : 2 : step;
  return <div className="live-workflow">
    <ol className="live-steps" aria-label="直播准备步骤">{['方式', '预览', live.output === 'camera' ? '输出' : '推流'].map((label, index) => <li key={label} aria-current={current === index + 1 ? 'step' : undefined} className={current > index + 1 ? 'completed' : ''}><span>{index + 1}</span>{label}</li>)}</ol>
    {current === 1 ? <>
      <strong className="live-section-title">直播方式</strong><div className="live-output-choices" role="group" aria-label="直播输出方式">
        <button aria-label="直接推流" aria-pressed={live.output === 'stream'} onClick={() => live.setOutput('stream')}><Radio size={30} /><strong>直接推流</strong><small>地址与密钥</small></button>
        <button aria-label="直播伴侣 / 助手" aria-pressed={live.output === 'camera'} onClick={() => live.setOutput('camera')}><Camera size={30} /><strong>直播伴侣 / 助手</strong><small>虚拟摄像头</small></button>
      </div>
      {live.output === 'stream' ? <LiveConnectionSettings model={live.profiles} next={() => setStep(2)} /> : <div className="live-camera-connection">
        <strong>小录 Virtual Camera</strong><button className="launcher-icon" title="在直播伴侣中添加摄像头，选择小录 Virtual Camera。声音、标题和公开开播在直播伴侣中设置。" aria-label="直播伴侣接入说明"><Info size={16} /></button>
        <span>{live.device?.installed ? '已安装' : live.device?.installable === false ? '当前版本暂不可用' : '首次使用需安装并完成系统确认'}</span>
        <footer className="live-workflow-footer">{live.device?.installed ? <button className="launcher-start" onClick={() => setStep(2)}>下一步</button>
          : <button className="launcher-start" aria-busy={live.installing} disabled={live.installing || !live.device?.available || live.device.installable === false} onClick={() => void live.install()}>{live.installing ? '安装中' : live.device?.installable === false ? '暂不可用' : '安装虚拟摄像头'}</button>}</footer>
        {live.device && !live.device.available && <div className="launcher-inline-error">虚拟摄像头组件未就绪，请重新安装小录</div>}
      </div>}
    </> : <LivePreviewSettings live={live} model={model} ready={ready} start={start} cameraSettings={cameraSettings} devices={devices}
      changeConnection={() => { model.clearError(); setStep(1); }} back={() => { model.clearError(); setStep(active ? 2 : 1); }} />}
  </div>;
}
