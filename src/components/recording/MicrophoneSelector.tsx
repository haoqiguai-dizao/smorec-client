import { AlertCircle, Mic, RefreshCw } from 'lucide-react';
import type { MicrophoneDevice } from '../../../shared/types';
import './microphone-selector.css';

interface Props {
  devices: MicrophoneDevice[]; selectedId: string; loading: boolean; disabled: boolean; error?: string;
  onChange: (id: string) => void; onRefresh: () => void;
}
export function MicrophoneSelector({ devices, selectedId, loading, disabled, error, onChange, onRefresh }: Props) {
  return <section className="recorder-microphone">
    <div className="camera-device-heading"><Mic size={14} /><strong>麦克风</strong><button className="icon-button" aria-label="刷新麦克风" onClick={onRefresh} disabled={disabled || loading}><RefreshCw size={12} className={loading ? 'spinning' : ''} /></button></div>
    <select aria-label="选择麦克风" value={selectedId} disabled={disabled || loading} onChange={event => onChange(event.target.value)}>
      <option value="">系统默认麦克风{devices.find(device => device.isDefault)?.name ? ` · ${devices.find(device => device.isDefault)?.name}` : ''}</option>
      {selectedId && !devices.some(device => device.id === selectedId) && <option value={selectedId}>已断开的麦克风</option>}
      {devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
    </select>
    {error && <div className="microphone-device-error" role="alert"><AlertCircle size={12} />{error}</div>}
  </section>;
}
