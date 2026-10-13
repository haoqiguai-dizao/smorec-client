export function missingSpeechModel(cause: unknown): boolean {
  return String(cause).includes('先下载本机语音模型');
}
