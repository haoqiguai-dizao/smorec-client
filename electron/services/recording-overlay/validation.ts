import { CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX } from '../../../shared/camera-zoom';
import { parsePresenterSettings } from '../../../shared/presenter';
import type { CameraPreviewMessage, RecordingControlAction } from '../../../shared/types';
import { parseCameraEffectsPatch } from '../validation';
import { isCameraShape } from '../../../shared/camera-shapes';
import { validCameraPreviewViewport } from '../../../shared/camera-preview';

export type OverlayRole = 'toolbar' | 'camera';
const maximumSignalBytes = 64 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的浮窗请求');
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value) || value.length > maximum) throw new Error('浮窗消息字段无效');
  return value;
}
export function trustedOverlayUrl(value: string, role: OverlayRole | 'whiteboard'): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'frameflow:' && url.hostname === 'app' && !url.port && !url.username && !url.password
      && url.pathname === '/index.html' && !url.hash && url.searchParams.size === 1 && url.searchParams.get('overlay') === role;
  } catch { return false; }
}
export function trustedOverlaySender(event: { sender: unknown; senderFrame: { url: string } | null },
  owner: { sender: unknown; mainFrame: { url: string } }, role: OverlayRole | 'whiteboard'): boolean {
  return event.sender === owner.sender && event.senderFrame === owner.mainFrame && trustedOverlayUrl(event.senderFrame.url, role);
}
export function parseOverlayControl(value: unknown): RecordingControlAction {
  const action = object(value);
  if (action.type === 'stop') return { type: 'stop' };
  if (action.type === 'microphone-source') {
    const source = object(action.value);
    if (typeof source.enabled !== 'boolean') throw new Error('麦克风开关无效');
    return { type: 'microphone-source', value: { enabled: source.enabled, deviceId: text(source.deviceId, 1024, true) } };
  }
  if (action.type === 'system-enabled' && typeof action.value === 'boolean') return { type: 'system-enabled', value: action.value };
  if (action.type === 'camera-presenter') return { type: 'camera-presenter', value: parsePresenterSettings(action.value) };
  if (action.type === 'camera-effects') return { type: 'camera-effects', value: parseCameraEffectsPatch(action.value) };
  if (action.type === 'camera-mode' && (action.value === 'overlay' || action.value === 'presenter')) {
    return { type: 'camera-mode', value: action.value };
  }
  if (['microphone-muted', 'system-muted', 'camera-visible', 'camera-mirror'].includes(String(action.type)) && typeof action.value === 'boolean') {
    return { type: action.type as 'microphone-muted' | 'system-muted' | 'camera-visible' | 'camera-mirror', value: action.value };
  }
  if (action.type === 'camera-shape' && isCameraShape(action.value)) return { type: action.type, value: action.value };
  if (action.type === 'camera-zoom' && typeof action.value === 'number' && Number.isFinite(action.value)
    && action.value >= CAMERA_ZOOM_MIN && action.value <= CAMERA_ZOOM_MAX) return { type: 'camera-zoom', value: action.value };
  if (action.type === 'camera-size' && typeof action.value === 'number' && Number.isFinite(action.value) && action.value >= .12 && action.value <= .42) {
    return { type: action.type, value: action.value };
  }
  throw new Error('未知或无效的录制操作');
}
export function parsePreviewSignal(value: unknown, expectedSession: string, from: 'host' | 'camera'): CameraPreviewMessage {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { throw new Error('摄像头预览信令不可序列化'); }
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > maximumSignalBytes) throw new Error('摄像头预览信令超过 64KB');
  const envelope = object(value), signal = object(envelope.signal);
  const sessionId = text(envelope.sessionId, 36);
  if (!uuid.test(sessionId) || sessionId !== expectedSession) throw new Error('摄像头预览会话已过期');
  if (signal.type === 'close' && from === 'camera') return { sessionId, signal: { type: 'close' } };
  if (signal.type === (from === 'host' ? 'offer' : 'answer')) {
    return { sessionId, signal: { type: signal.type as 'offer' | 'answer', sdp: text(signal.sdp, maximumSignalBytes) } };
  }
  if (signal.type === 'viewport' && from === 'camera') {
    if (!validCameraPreviewViewport(signal.viewport)) throw new Error('摄像头预览显示尺寸无效');
    const { width, height, density, visible, revision } = signal.viewport;
    return { sessionId, signal: { type: 'viewport', viewport: { width, height, density, visible, revision } } };
  }
  if (signal.type !== 'candidate') throw new Error('摄像头预览信令方向无效');
  const input = object(signal.candidate), candidate: RTCIceCandidateInit = { candidate: text(input.candidate, 8192, true) };
  for (const key of ['sdpMid', 'usernameFragment'] as const) {
    if (input[key] !== undefined) candidate[key] = input[key] === null ? null : text(input[key], 256, true);
  }
  if (input.sdpMLineIndex !== undefined) {
    const index = input.sdpMLineIndex;
    if (index !== null && (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 65535)) throw new Error('摄像头 ICE 序号无效');
    candidate.sdpMLineIndex = index as number | null;
  }
  return { sessionId, signal: { type: 'candidate', candidate } };
}
