import { LoaderCircle, Video, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CameraEffects } from '../../../shared/types';
import { useCameraEffectPreview } from '../../hooks/useCameraEffectPreview';
import type { CameraConnectionPhase } from '../../services/camera-acquisition';

export interface CameraControls {
  enabled: boolean;
  devices: { deviceId: string; label: string }[];
  selectedDeviceId: string;
  stream: MediaStream | null;
  loading: boolean;
  phase?: CameraConnectionPhase;
  error?: string;
  onEnabledChange: (enabled: boolean) => void;
  onDeviceChange: (id: string) => void;
  onRefresh: () => void;
}

export function CameraPreview({ stream, loading = false, phase, error, mirror = true, className = '', effects }: { stream: MediaStream | null; loading?: boolean; phase?: CameraConnectionPhase; error?: string; mirror?: boolean; className?: string; effects?: CameraEffects }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const effectError = useCameraEffectPreview(video, canvas, stream, effects);
  const [ready, setReady] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  useEffect(() => {
    const element = video.current;
    setReady(false); setPlaybackError(false);
    if (!element) return;
    element.srcObject = stream;
    if (stream) void element.play().catch(() => setPlaybackError(true));
    return () => { element.pause(); element.srcObject = null; };
  }, [stream]);
  return <div className={`camera-live-preview ${className}`}>
    <video ref={video} muted autoPlay playsInline onLoadedData={() => setReady(true)} style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, pointerEvents: 'none' }} aria-label="摄像头预览" />
    <canvas ref={canvas} aria-label="摄像头效果预览" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', transform: mirror ? 'scaleX(-1)' : undefined, opacity: ready && !error && !effectError ? 1 : 0 }} />
    {(!ready || error || effectError) && <div className="camera-preview-placeholder">{loading ? <LoaderCircle className="spinning" size={24} /> : error || playbackError || effectError ? <VideoOff size={25} strokeWidth={1.5} /> : <Video size={25} strokeWidth={1.5} />}<span title={effectError}>{loading ? phase === 'frames' ? '正在等待摄像头画面' : '正在连接摄像头' : error ? '摄像头不可用' : effectError ? '效果暂不可用，可关闭美颜重试' : playbackError ? '预览暂不可用' : '摄像头预览'}</span></div>}
    {ready && !error && <span className="camera-live-badge"><i />实时预览</span>}
  </div>;
}
