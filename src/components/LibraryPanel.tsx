import { ArrowDownToLine, Check, FolderOpen, HardDrive, ListChecks, PanelLeftClose, PanelLeftOpen, Plus, Search, Trash2, X } from 'lucide-react';
import type { ProjectSummary } from '../../shared/types';
import { useProjectLibrary, type LibraryActions } from '../hooks/useProjectLibrary';
import { DeleteProjectsDialog, RenameProjectDialog } from './library/LibraryDialogs';
import { ProjectMenu } from './library/ProjectMenu';
import { ProjectRow } from './library/ProjectRow';

interface Props extends LibraryActions {
  projects: ProjectSummary[];
  activeId?: string;
  onLoad: (id: string) => void;
  onImport: () => void;
  onOpen: () => void;
  onRecord: () => void;
  busy: boolean;
  managementBusy?: boolean;
}

export function LibraryPanel({ projects, activeId, onLoad, onImport, onOpen, onRecord, busy, managementBusy = false, onRename, onReveal, onDelete }: Props) {
  const library = useProjectLibrary(projects, busy || managementBusy, { onRename, onReveal, onDelete });
  const { collapsed, query, managing, disabled, filtered } = library;
  return <aside className={`library-panel ${collapsed ? 'is-collapsed' : ''} ${managing ? 'is-managing' : ''}`}>
    <div className="library-top">
      <div className="panel-eyebrow"><span>项目</span><button className="icon-button" aria-label={collapsed ? '展开项目列表' : '收起项目列表'} title={collapsed ? '展开项目列表' : '收起项目列表'} onClick={library.toggleCollapsed}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
      <button className="button record-button" onClick={onRecord} disabled={disabled} title="新建录制" aria-label="新建录制"><span className="record-dot" /><span className="library-action-label">新建录制</span><Plus size={15} /></button>
      <div className="library-actions"><button onClick={onImport} disabled={disabled} title="导入视频" aria-label="导入视频"><ArrowDownToLine size={15} /><span className="library-action-label">导入视频</span></button><button onClick={onOpen} disabled={disabled} title="打开项目" aria-label="打开项目"><FolderOpen size={15} /><span className="library-action-label">打开项目</span></button></div>
    </div>
    <div className="library-heading"><span className="library-heading-label">最近项目 <span>{projects.length}</span></span><button className="library-manage-button" aria-label="管理项目" aria-pressed={managing} title="管理项目" onClick={library.toggleManaging} disabled={disabled}>{managing ? <Check size={14} /> : <ListChecks size={14} />}<span>{managing ? '完成' : '管理'}</span></button></div>
    {!collapsed && projects.length > 0 && <div className="library-search"><Search size={13} /><input aria-label="搜索项目" placeholder="搜索项目" value={query} onChange={event => library.setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') library.setQuery(''); }} />{query && <button aria-label="清除项目搜索" onClick={() => library.setQuery('')}><X size={12} /></button>}</div>}
    {managing && !collapsed && <div className="library-selection-bar"><button onClick={library.selectFiltered} disabled={disabled || !filtered.length}>{library.allFilteredSelected ? '取消当前搜索结果选择' : '选择当前搜索结果'}</button><span aria-live="polite">已选 {library.selectedProjects.length}</span></div>}
    {library.notice && !collapsed && <div className="library-notice" role="alert"><span>{library.notice}</span><button aria-label="关闭项目操作错误" onClick={library.clearNotice}><X size={12} /></button></div>}
    <div className="project-list">
      {filtered.map(project => <ProjectRow key={project.id} project={project} active={project.id === activeId} managing={managing} selected={library.selected.includes(project.id)} disabled={disabled} onLoad={onLoad} onSelect={library.select} onMenu={library.setMenu} />)}
      {!projects.length && <div className="library-empty"><FolderOpen size={22} strokeWidth={1.5} /><span>还没有项目</span></div>}
      {!!projects.length && !filtered.length && <div className="library-empty"><Search size={20} /><span>没有匹配的项目</span></div>}
    </div>
    <footer className="library-footer">{managing && !collapsed ? <button className="library-batch-delete" aria-label="删除所选项目" disabled={disabled || !library.selectedProjects.length} onClick={() => library.beginDelete(library.selectedProjects)}><Trash2 size={14} /><span>移到回收站</span><span>{library.selectedProjects.length}</span></button> : <span className="local-status" title="项目与原始素材保存在这台电脑"><HardDrive size={13} /><span>本地保存</span></span>}</footer>
    {library.menu && <ProjectMenu menu={library.menu} onClose={() => library.setMenu(null)} onRename={library.beginRename} onReveal={project => void library.reveal(project)} onDelete={project => library.beginDelete([project])} />}
    {library.renaming && <RenameProjectDialog key={library.renaming.id} project={library.renaming} busy={disabled} error={library.renameError} onClose={library.dismissRename} onSave={name => void library.rename(name)} />}
    {library.deletion && <DeleteProjectsDialog deletion={library.deletion} busy={disabled} onClose={library.dismissDeletion} onConfirm={() => void library.remove()} />}
  </aside>;
}
