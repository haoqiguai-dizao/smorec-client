/** 只用于显示快捷键；快捷键注册仍由各平台的原生代码负责。 */
export function shortcutLabel(keys: string, platform = typeof navigator === 'undefined' ? 'win32' : navigator.userAgent.includes('Macintosh') ? 'darwin' : 'win32'): string {
  return platform === 'darwin' ? keys.replaceAll('Ctrl', '⌘').replaceAll('Alt', '⌥').replaceAll('Shift', '⇧') : keys;
}
