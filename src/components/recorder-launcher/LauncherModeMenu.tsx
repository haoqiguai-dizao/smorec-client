import { Check, Radio, Video } from 'lucide-react';
import { useEffect, useRef } from 'react';

export function LauncherModeMenu({ mode, choose, close }: {
  mode: 'record' | 'live'; choose(mode: 'record' | 'live'): void; close(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!menu.current?.contains(target) && !target.closest('[data-toolbar-focus="mode"]')) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [close]);
  return <div className="launcher-mode-menu" role="menu" aria-label="工作模式" ref={menu} data-toolbar-surface
    onKeyDown={event => {
      if (event.key === 'Tab') close();
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close();
        document.querySelector<HTMLButtonElement>('[data-toolbar-focus="mode"]')?.focus();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>
    {([{ value: 'record', label: '录屏', icon: Video }, { value: 'live', label: '直播', icon: Radio }] as const).map(item =>
      <button key={item.value} type="button" role="menuitemradio" aria-checked={mode === item.value}
        tabIndex={mode === item.value ? 0 : -1}
        onClick={() => choose(item.value)}>{mode === item.value ? <Check size={17} /> : <item.icon size={17} />}<span>{item.label}</span></button>)}
  </div>;
}
