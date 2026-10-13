/** Keep native/IPC diagnostics in logs while showing the actionable device error. */
export function recordingErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/, '')
    .replace(/。诊断日志：[\s\S]*$/, '').replace(/。{2,}/g, '。').trim() || '操作失败，请重试';
}
