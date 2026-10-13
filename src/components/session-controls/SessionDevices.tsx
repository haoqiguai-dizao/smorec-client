import { Mic, MicOff, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import type { SessionDevices as Devices } from './types';
import { ToolbarDevice } from './ToolbarDevice';

export function SessionDevices({ devices, compact = false }: { devices: Devices; compact?: boolean }) {
  const controls = [
    { key: 'camera', label: '摄像头', on: Video, off: VideoOff },
    { key: 'microphone', label: '麦克风', on: Mic, off: MicOff },
    { key: 'system', label: '系统声', on: Volume2, off: VolumeX },
  ] as const;
  return <div className="session-devices" role="group" aria-label="画面与声音">
    {controls.map(({ key, label, on: On, off: Off }) => {
      const device = devices[key];
      return <div className={`session-device-slot ${key}`} key={key}><ToolbarDevice label={label} icon={device.enabled ? On : Off} device={device} compact={compact} /></div>;
    })}
  </div>;
}
