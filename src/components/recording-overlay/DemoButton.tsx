import { AlertCircle, Eye, EyeOff, LoaderCircle, Presentation } from 'lucide-react';
import { useDemoMode } from '../../hooks/useDemoMode';
import { shortcutLabel } from '../../../shared/shortcut-label';

export function DemoButton({ launcher = false }: { launcher?: boolean }) {
  const { state, error, menu } = useDemoMode();
  if (!state) return null;
  const label = state.enabled ? state.visible ? '演示 · 界面入画' : '演示 · 界面隐藏' : '演示模式';
  const Icon = error ? AlertCircle : state.busy ? LoaderCircle : !state.enabled ? Presentation : state.visible ? Eye : EyeOff;
  return <button className={launcher ? `launcher-mode launcher-demo ${state.enabled ? 'active' : ''}` : state.enabled ? 'active' : ''}
    aria-label={label} aria-pressed={state.enabled} disabled={state.busy || state.active && !state.ready}
    title={error ?? `${label} · ${state.shortcutAvailable ? shortcutLabel('Ctrl+Shift+D') : '快捷键被占用，请使用按钮或托盘'}`}
    onClick={() => void menu()}><Icon size={18} />{launcher && <span>演示</span>}</button>;
}
