import { shortcutLabel } from '../../shared/shortcut-label';
import { Check, Maximize2, Minus, ArrowUpRight, PencilLine, Save, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../../shared/brand';

interface Props {
  projectName: string;
  dirty: boolean;
  onRename: (name: string) => void;
  onSave: () => void;
  onExport: () => void;
  canExport: boolean;
  canSave: boolean;
  busy: boolean;
}

export function TitleBar({ projectName, dirty, onRename, onSave, onExport, canExport, canSave, busy }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(projectName);
  const finished = useRef(false);
  useEffect(() => setName(projectName), [projectName]);
  const commit = () => {
    if (finished.current) return;
    finished.current = true;
    if (name.trim() && name.trim() !== projectName) onRename(name.trim());
    else setName(projectName);
    setEditing(false);
  };

  return <header className="titlebar">
    <div className="brand"><img className="brand-mark" src={new URL('../assets/xiaolu-icon.png', import.meta.url).href} alt="" /><strong>{APP_NAME}</strong></div>
    <div className="titlebar-project no-drag">
      {editing ? <input className="project-title-input" autoFocus onFocus={event => event.currentTarget.select()} value={name} maxLength={120} aria-label="项目名称" onChange={e => setName(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return; if (e.key === 'Enter') commit(); if (e.key === 'Escape') { finished.current = true; setName(projectName); setEditing(false); } }} />
        : <button className="project-title" onClick={() => { finished.current = false; setEditing(true); }} disabled={!canSave || busy} title="重命名项目"><span>{projectName}</span>{canSave && <PencilLine size={12} />}</button>}
      {canSave && <span className={dirty ? 'save-state dirty' : 'save-state'} title={dirty ? '有未保存的修改' : '项目已保存'}>{dirty ? <i /> : <Check size={12} />}{dirty ? '未保存' : '已保存'}</span>}
    </div>
    <div className="titlebar-actions no-drag">
      <button className="button secondary titlebar-save" onClick={onSave} disabled={busy || !canSave} title={shortcutLabel('保存项目 · Ctrl+S')} aria-label="保存项目"><Save size={16} /><span>保存</span></button>
      <button id="export-video-action" className="button primary export-button" onClick={onExport} disabled={!canExport || busy}>导出视频<ArrowUpRight size={14} /></button>
      <div className="window-controls">
        <button aria-label="最小化" onClick={() => window.studio?.minimize()}><Minus size={14} /></button>
        <button aria-label="最大化" onClick={() => window.studio?.maximize()}><Maximize2 size={12} /></button>
        <button className="window-close" aria-label="返回录制栏" title={busy ? '当前操作完成后可返回录制栏' : '关闭编辑器，返回录制栏'}
          disabled={busy} onClick={() => window.studio?.close()}><X size={15} /></button>
      </div>
    </div>
  </header>;
}
