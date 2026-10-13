import { useId, useState, useSyncExternalStore } from 'react';
import { Info, RotateCcw } from 'lucide-react';
import type { CameraEffects } from '../../../shared/types';
import { hasFaceEffects } from '../../../shared/beauty';
import { CAMERA_FILTERS } from '../../../shared/camera-effects';
import { currentFaceStatus, FACE_STATUS_EVENT, retryFaceTracking } from '../../services/camera-effects/face/tracker';
import { BEAUTY_CONTROLS, BEAUTY_TABS, type BeautyTab } from './beauty-controls';

const subscribe = (listener: () => void) => {
  window.addEventListener(FACE_STATUS_EVENT, listener);
  return () => window.removeEventListener(FACE_STATUS_EVENT, listener);
};
const statuses = { idle: '开启预览后生效', loading: '正在准备人脸美颜', tracking: '已识别人脸', 'no-face': '等待人脸入镜', error: '人脸美颜加载失败' };

export function BeautyParameters({ value, disabled, update }: {
  value: CameraEffects; disabled: boolean; update: (patch: Partial<CameraEffects>) => void;
}) {
  const [tab, setTab] = useState<BeautyTab>('skin');
  const id = useId(), status = useSyncExternalStore(subscribe, currentFaceStatus);
  return <>
    <div className="beauty-tabs" role="tablist" aria-label="美颜分类">{BEAUTY_TABS.map((item, index) => <button
      key={item.id} id={`${id}-${item.id}`} type="button" role="tab" aria-selected={tab === item.id}
      aria-controls={`${id}-panel`} tabIndex={tab === item.id ? 0 : -1}
      onClick={() => setTab(item.id)} onKeyDown={event => {
        let next: number;
        if (event.key === 'ArrowRight') next = (index + 1) % BEAUTY_TABS.length;
        else if (event.key === 'ArrowLeft') next = (index + BEAUTY_TABS.length - 1) % BEAUTY_TABS.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = BEAUTY_TABS.length - 1;
        else return;
        event.preventDefault(); setTab(BEAUTY_TABS[next].id);
        document.getElementById(`${id}-${BEAUTY_TABS[next].id}`)?.focus();
      }}>{item.label}</button>)}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="beauty-parameters">
      {tab === 'filter' ? <>
        <div className="camera-effects-filters" role="group" aria-label="摄像头滤镜">{CAMERA_FILTERS.map(filter => <button
          key={filter.id} disabled={disabled} aria-pressed={value.filter === filter.id} onClick={() => update({ filter: filter.id })}>{filter.label}</button>)}</div>
        <label className="camera-effects-slider"><span>滤镜强度<output>{Math.round(value.intensity * 100)}%</output></span>
          <input aria-label="滤镜强度" type="range" min="0" max="100" value={Math.round(value.intensity * 100)} disabled={disabled}
            onChange={event => update({ intensity: Number(event.target.value) / 100 })} /></label>
      </> : <div className="beauty-sliders">{BEAUTY_CONTROLS[tab].map(control => {
        const amount = Math.round((value[control.key] ?? 0) * 100);
        return <div className="beauty-control" key={control.key}>
          <div className="beauty-control-heading"><label htmlFor={`${id}-${control.key}`}>{control.label}</label>
            <button className="beauty-help" type="button" aria-label={`${control.label}说明`} title={control.help}><Info size={12} /></button>
            <input className="beauty-number" aria-label={`${control.label}数值`} type="number" min={control.signed ? -100 : 0} max={100} step={1}
              value={amount} disabled={disabled} onChange={event => { if (event.target.value !== '') update({ [control.key]: Math.max(control.signed ? -100 : 0, Math.min(100, Number(event.target.value))) / 100 }); }} />
            <button className="beauty-reset" type="button" aria-label={`重置${control.label}`} title="单项归零" disabled={disabled || !amount}
              onClick={() => update({ [control.key]: 0 })}><RotateCcw size={11} /></button></div>
          <input id={`${id}-${control.key}`} aria-label={control.label} type="range" min={control.signed ? -100 : 0} max={100} step={1}
            value={amount} disabled={disabled} onChange={event => update({ [control.key]: Number(event.target.value) / 100 })} />
        </div>;
      })}</div>}
    </div>
    {hasFaceEffects(value) && <div className={`beauty-status beauty-status-${status}`} role="status">
      <span>{statuses[status]}</span>{status === 'error' && <button type="button" onClick={retryFaceTracking}>重试</button>}
      <button type="button" className="beauty-help" aria-label="人脸美颜说明" title="本机离线处理；适合单人入镜。快速转头或遮挡时，五官调整会减弱或暂停。"><Info size={12} /></button>
    </div>}
  </>;
}
