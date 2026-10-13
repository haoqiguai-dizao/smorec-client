/** Native getUserMedia also uses AbortError; only our own cancellation is silent. */
export class CameraConnectionCanceledError extends DOMException {
  constructor() { super('摄像头连接已取消', 'AbortError'); }
}
export const cameraConnectionCanceled = (error: unknown): boolean => error instanceof CameraConnectionCanceledError;

export function cameraError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError') return '摄像头权限未开启，请在系统隐私设置中允许小录访问摄像头';
    if (error.name === 'NotFoundError') return '未检测到摄像头，请连接设备后刷新';
    if (error.name === 'OverconstrainedError') return (error as Error & { constraint?: string }).constraint === 'deviceId'
      ? '所选摄像头不可用，请连接或选择其他设备' : '摄像头不支持所选录制格式，请选择自动或较低帧率';
    if (error.name === 'NotReadableError') return '摄像头被其他应用占用或无法读取，请关闭占用它的应用后重试';
    if (error.name === 'AbortError' && !cameraConnectionCanceled(error)) return '摄像头已识别，但启动失败，请点击刷新重试或切换设备';
    return error.message;
  }
  return '无法打开摄像头';
}
