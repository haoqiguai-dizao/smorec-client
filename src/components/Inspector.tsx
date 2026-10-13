import { AudioLines, Focus, MousePointer2, SlidersHorizontal, Square, Video } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { CanvasStyle, Project } from '../../shared/types';
import { outputToSourceTime } from '../../shared/timeline';
import { AudioPanel } from './inspector/AudioPanel';
import { CanvasPanel } from './inspector/CanvasPanel';
import type { CanvasBackgroundProps } from './inspector/CanvasBackgroundPanel';
import { CursorPanel } from './inspector/CursorPanel';
import { ZoomPanel } from './inspector/ZoomPanel';
import { WebcamPanel } from './inspector/WebcamPanel';
import { readAppPreferences, updateAppPreferences } from '../services/app-preferences';
import type { CompositionEditingProps } from './composition-types';
import { CompositionPanel } from './inspector/CompositionPanel';

interface Props extends CompositionEditingProps, CanvasBackgroundProps { project: Project; currentTime: number; onChange: (patch: Partial<Project>) => void; selectedZoomId: string | null; onSelectZoom: (id: string | null) => void; onAutoZoom: () => void }
type Tab = 'canvas' | 'camera' | 'cursor' | 'audio' | 'zoom';
const tabs = [{ id: 'canvas', title: '画布', icon: Square }, { id: 'camera', title: '摄像头', icon: Video }, { id: 'cursor', title: '光标', icon: MousePointer2 }, { id: 'audio', title: '声音', icon: AudioLines }, { id: 'zoom', title: '缩放', icon: Focus }] as const;

export function Inspector({ project, currentTime, onChange, selectedZoomId, onSelectZoom, onAutoZoom,
  onChooseBackground, importingBackground, ...compositionEditing }: Props) {
  const [tab, setTabState] = useState<Tab>(() => readAppPreferences().editor.inspectorTab);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [tab, compositionEditing.selectedCompositionId]);
  const setTab = (next: Tab) => { setTabState(next); updateAppPreferences({ editor: { inspectorTab: next } }); };
  useEffect(() => { if (selectedZoomId) setTabState('zoom'); }, [selectedZoomId]);
  useEffect(() => { if (compositionEditing.selectedCompositionId) setTabState('camera'); }, [compositionEditing.selectedCompositionId]);
  const composition = project.compositions?.find(segment => segment.id === compositionEditing.selectedCompositionId);
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const index = tabs.findIndex(item => item.id === tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); setTab(tabs[next].id);
    event.currentTarget.querySelector<HTMLButtonElement>(`#inspector-tab-${tabs[next].id}`)?.focus();
  };
  const setStyle = (patch: Partial<CanvasStyle>) => onChange({ style: { ...project.style, ...patch } });
  return <aside className="inspector-panel"><div className="inspector-heading"><span>属性</span><SlidersHorizontal size={14} /></div><div className="inspector-tabs" role="tablist" aria-label="编辑属性" onKeyDown={navigate}>{tabs.map(({ id, title, icon: Icon }) => <button key={id} id={`inspector-tab-${id}`} role="tab" aria-controls="inspector-tabpanel" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16} /><span>{title}</span></button>)}</div><div ref={contentRef} className="inspector-content" id="inspector-tabpanel" role="tabpanel" aria-labelledby={`inspector-tab-${tab}`} tabIndex={0}>
    {tab === 'canvas' && <CanvasPanel style={project.style} onChange={setStyle} backgrounds={project.backgrounds}
      onChooseBackground={onChooseBackground} importingBackground={importingBackground} />}{tab === 'cursor' && <CursorPanel style={project.style} hasCursor={project.cursor.length > 0} onChange={setStyle} />}{tab === 'audio' && <AudioPanel project={project} onChange={audio => onChange({ audio })} />}{tab === 'zoom' && <ZoomPanel project={project} selectedId={selectedZoomId} onSelect={onSelectZoom} onChange={zooms => onChange({ zooms })} onAutoZoom={onAutoZoom} />}
    {tab === 'camera' && (composition ? <CompositionPanel project={project} segment={composition}
      sourceTime={outputToSourceTime(project.clips, currentTime)} {...compositionEditing} />
      : <WebcamPanel project={project} sourceTime={outputToSourceTime(project.clips, currentTime)} onChange={camera => onChange({ camera })}
        onAspectChange={aspect => onChange({ style: { ...project.style, aspect } })} />)}
    </div><div className="inspector-footnote"><span>{project.width} × {project.height}</span><span>{project.fps} FPS</span></div></aside>;
}
