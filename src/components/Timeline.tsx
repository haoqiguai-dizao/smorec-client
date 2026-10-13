import { AudioLines, Camera, Focus, Pause, Play, Plus, Scissors, SkipBack, SkipForward, Trash2, Video, ZoomIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Clip, Project, ZoomSegment } from '../../shared/types';
import { getOutputDuration, outputToSourceTime } from '../../shared/timeline';
import { RangeBlock } from './timeline/RangeBlock';
import { readAppPreferences, updateAppPreferences } from '../services/app-preferences';
import type { CompositionEditingProps } from './composition-types';
import { CompositionTrack } from './timeline/CompositionTrack';
import { CompositionTimelineTools } from './timeline/CompositionTimelineTools';
import type { selectionDeletion } from '../../shared/editor-selection';

interface Props extends CompositionEditingProps {
  project: Project; currentTime: number; duration: number; playing: boolean;
  onSeek: (outputTime: number) => void; onTogglePlay: () => void; onSplit: () => void;
  onDeleteClip: (id: string) => void; onTrim: (clipId: string, start: number, end: number) => void;
  selectedClipId?: string | null; onSelectClip?: (id: string | null) => void;
  onDeleteSelected?: () => void; deletion?: ReturnType<typeof selectionDeletion>;
  onAddZoom: () => void; selectedZoomId: string | null; onSelectZoom: (id: string | null) => void;
  onUpdateZoom?: (id: string, patch: Partial<ZoomSegment>) => void;
}

function formatTime(time: number, precise = false) {
  const value = Math.max(0, Number.isFinite(time) ? time : 0);
  const base = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  return precise ? `${base}.${String(Math.floor((value % 1) * 100)).padStart(2, '0')}` : base;
}

function ClipTrim({ clip, min, max, minLength, onTrim }: { clip: Clip; min: number; max: number; minLength: number; onTrim: Props['onTrim'] }) {
  const [start, setStart] = useState(String(Number(clip.start.toFixed(3))));
  const [end, setEnd] = useState(String(Number(clip.end.toFixed(3))));
  useEffect(() => { setStart(String(Number(clip.start.toFixed(3)))); setEnd(String(Number(clip.end.toFixed(3)))); }, [clip.id, clip.start, clip.end]);
  const commit = () => {
    const changedStart = start !== String(Number(clip.start.toFixed(3)));
    const changedEnd = end !== String(Number(clip.end.toFixed(3)));
    if (!changedStart && !changedEnd) return;
    const from = changedStart ? Number(start) : clip.start;
    const to = changedEnd ? Number(end) : clip.end;
    if (start !== '' && end !== '' && Number.isFinite(from) && Number.isFinite(to) && from >= min && to <= max && to - from >= minLength) onTrim(clip.id, from, to);
    else { setStart(String(Number(clip.start.toFixed(3)))); setEnd(String(Number(clip.end.toFixed(3)))); }
  };
  return <div className="clip-trim"><span>原始秒</span><label title="片段在原始素材中的开始秒数"><input aria-label="原始开始秒数" type="number" min={min} max={clip.end - minLength} step={0.1} value={start} onChange={e => setStart(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label><span>—</span><label title="片段在原始素材中的结束秒数"><input aria-label="原始结束秒数" type="number" min={clip.start + minLength} max={max} step={0.1} value={end} onChange={e => setEnd(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label></div>;
}

export function Timeline({ project, currentTime, duration, playing, onSeek, onTogglePlay, onSplit, onDeleteClip, onTrim, onAddZoom, selectedZoomId, onSelectZoom, onUpdateZoom,
  selectedClipId: controlledClipId, onSelectClip, onDeleteSelected, deletion, ...compositionEditing }: Props) {
  const [localClipId, setLocalClipId] = useState('');
  const selectedClipId = controlledClipId === undefined ? localClipId : controlledClipId;
  const setSelectedClipId = (id: string) => { if (onSelectClip) onSelectClip(id || null); else setLocalClipId(id); };
  const tracks = useRef<HTMLDivElement>(null);
  const [timelineScale, setTimelineScaleState] = useState(() => readAppPreferences().editor.timelineScale);
  const setTimelineScale = (value: number) => { setTimelineScaleState(value); updateAppPreferences({ editor: { timelineScale: value } }); };
  const scrubbing = useRef(false);
  useEffect(() => { if (!project.clips.some(clip => clip.id === localClipId)) setLocalClipId(''); }, [project.clips, localClipId]);
  useEffect(() => { if (compositionEditing.selectedCompositionId || selectedZoomId) setLocalClipId(''); }, [compositionEditing.selectedCompositionId, selectedZoomId]);
  const total = Math.max(0.001, getOutputDuration(project.clips));
  const selectedClip = project.clips.find(clip => clip.id === selectedClipId);
  const selectedClipIndex = project.clips.findIndex(clip => clip.id === selectedClipId);
  const outputTime = Math.min(total, Math.max(0, currentTime));
  const desiredStep = total / (6 * timelineScale);
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find(value => value >= desiredStep) ?? 3600;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, index) => index * step);
  let clipOffset = 0;
  const positionedClips = project.clips.map(clip => { const result = { ...clip, offset: clipOffset }; clipOffset += clip.end - clip.start; return result; });
  const orderedZooms = [...project.zooms].sort((a, b) => a.start - b.start);
  const visibleZooms = project.zooms.flatMap((zoom, index) => positionedClips.flatMap(clip => {
    const from = Math.max(clip.start, zoom.start); const to = Math.min(clip.end, zoom.end);
    return to > from ? [{ ...zoom, key: `${zoom.id}-${clip.id}`, index, segment: clip, offset: clip.offset + from - clip.start, length: to - from }] : [];
  }));
  const positionAt = (clientX: number) => {
    const bounds = tracks.current?.getBoundingClientRect();
    return bounds ? (clientX - bounds.left) / bounds.width * total : 0;
  };
  const outputAt = (clientX: number) => Math.max(0, Math.min(total, positionAt(clientX)));
  const seekAt = (clientX: number) => onSeek(outputAt(clientX));
  const sourceAt = (clientX: number) => {
    const output = positionAt(clientX);
    if (output < 0) return (project.clips[0]?.start ?? 0) + output;
    if (output > total) return (project.clips.at(-1)?.end ?? 0) + output - total;
    return outputToSourceTime(project.clips, output);
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.button !== 0) return; compositionEditing.onSelectComposition?.(null); scrubbing.current = true; event.currentTarget.setPointerCapture(event.pointerId); seekAt(event.clientX); };

  return <section className="timeline-panel" aria-label="编辑时间轴">
    <div className="playback-bar"><div className="playback-left"><span className="timeline-label">时间轴</span><span className="timeline-length">{project.clips.length} 个片段</span></div><div className="playback-controls"><button className="icon-button" aria-label="跳到开始" onClick={() => onSeek(0)}><SkipBack size={15} /></button><button className="play-button" aria-label={playing ? '暂停' : '播放'} title="播放 / 暂停 · 空格" onClick={onTogglePlay}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button><button className="icon-button" aria-label="跳到结束" onClick={() => onSeek(Math.max(0, duration - 1 / project.fps))}><SkipForward size={15} /></button></div><div className="playback-time"><strong>{formatTime(currentTime, true)}</strong><span>/</span><span>{formatTime(duration, true)}</span></div></div>
    <div className="timeline-toolbar">
      <button className="tool-button" onClick={onSplit} disabled={!project.clips.length} title="在播放位置分割 · S"><Scissors size={14} />分割<kbd>S</kbd></button>
      <button className="tool-button" onClick={onAddZoom} disabled={!project.clips.length}><Plus size={14} />添加镜头</button>
      <button className="icon-button delete-clip" aria-label={deletion?.label ?? '删除选中片段'}
        title={deletion?.reason || `${deletion?.label ?? '删除选中片段'} · Delete / Backspace`}
        disabled={deletion ? !deletion.enabled : !selectedClip || project.clips.length < 2}
        onClick={() => { if (onDeleteSelected) onDeleteSelected(); else if (selectedClip) onDeleteClip(selectedClip.id); }}><Trash2 size={14} /></button>
      {project.media.camera && compositionEditing.onAddComposition && <CompositionTimelineTools project={project}
        sourceTime={outputToSourceTime(project.clips, currentTime)} {...compositionEditing} />}
      {selectedClip && <ClipTrim clip={selectedClip} min={project.clips[selectedClipIndex - 1]?.end ?? 0} max={project.clips[selectedClipIndex + 1]?.start ?? project.duration} minLength={1 / project.fps} onTrim={onTrim} />}
      <label className="timeline-scale" title="缩放时间轴"><ZoomIn size={13} /><input aria-label="缩放时间轴" type="range" min={1} max={6} step={.25} value={timelineScale} onChange={event => setTimelineScale(Number(event.target.value))} /><span>{timelineScale.toFixed(1)}×</span></label>
    </div>
    <div className="timeline-scroll"><div className="timeline-track-labels"><div className="ruler-spacer" /><span><Video size={14} />画面</span><span><Focus size={14} />镜头</span>{project.media.camera && <span><Camera size={14} />摄像头</span>}{(project.media.systemAudio || project.media.microphone) && <span><AudioLines size={14} />声音</span>}</div><div className="timeline-horizontal"><div className="timeline-tracks" style={{ width: `${timelineScale * 100}%` }} ref={tracks} onPointerDown={pointerDown} onPointerMove={event => { if (scrubbing.current) seekAt(event.clientX); }} onPointerUp={event => { scrubbing.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { scrubbing.current = false; }}>
      <div className="timeline-ruler" role="slider" tabIndex={0} aria-label="播放位置" aria-valuemin={0} aria-valuemax={total} aria-valuenow={outputTime} aria-valuetext={formatTime(outputTime, true)} onKeyDown={event => {
        const frame = 1 / project.fps;
        const increment = event.shiftKey ? 1 : frame;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? total - frame : event.key === 'ArrowLeft' ? outputTime - increment : event.key === 'ArrowRight' ? outputTime + increment : null;
        if (next !== null) { event.preventDefault(); onSeek(Math.max(0, Math.min(total - frame, next))); }
      }}>{ticks.map(tick => <span key={tick} className={Math.abs(tick - total) < .001 ? 'ruler-end' : undefined} style={{ left: `${tick / total * 100}%` }}>{formatTime(tick, step < 1)}</span>)}</div>
      <div className="timeline-track video-track">{positionedClips.map((clip, index) => <RangeBlock key={clip.id} kind="clip" name={project.clips.length > 1 ? `片段 ${index + 1}` : project.name} range={clip} offset={clip.offset} total={total} min={project.clips[index - 1]?.end ?? 0} max={project.clips[index + 1]?.start ?? project.duration} fps={project.fps} selected={selectedClipId === clip.id} sourceAt={positionAt} onSelect={() => { setSelectedClipId(clip.id); onSelectZoom(null); compositionEditing.onSelectComposition?.(null); }} onSeek={seekAt} onCommit={(start, end) => onTrim(clip.id, start, end)} />)}</div>
      <div className="timeline-track zoom-track">{visibleZooms.map(zoom => { const position = orderedZooms.findIndex(item => item.id === zoom.id); return <RangeBlock key={zoom.key} kind="zoom" name={`镜头 ${zoom.index + 1}`} label={`${zoom.scale.toFixed(1)}×`} range={zoom} offset={zoom.offset} segment={zoom.segment} total={total} min={orderedZooms[position - 1]?.end ?? 0} max={orderedZooms[position + 1]?.start ?? project.duration} fps={project.fps} selected={selectedZoomId === zoom.id} sourceAt={sourceAt} onSelect={() => { setSelectedClipId(''); onSelectZoom(zoom.id); }} onSeek={seekAt} onCommit={onUpdateZoom ? (start, end) => onUpdateZoom(zoom.id, { start, end }) : undefined} />; })}{!project.zooms.length && <button className="empty-track-add" onPointerDown={event => event.stopPropagation()} onClick={onAddZoom}><Plus size={12} />添加缩放镜头</button>}</div>
      {project.media.camera && (compositionEditing.onAddComposition ? <CompositionTrack project={project} total={total}
        sourceAt={sourceAt} onSeek={seekAt} {...compositionEditing} onSelectComposition={id => {
          setSelectedClipId(''); onSelectZoom(null); compositionEditing.onSelectComposition?.(id);
        }} /> : <div className="timeline-track camera-track"><div className="timeline-camera"><Camera size={13} /><span>摄像头画面</span></div></div>)}
      {(project.media.systemAudio || project.media.microphone) && <div className="timeline-track audio-track"><div className="timeline-audio"><AudioLines size={13} /><span>{[project.media.systemAudio && '系统声音', project.media.microphone && '麦克风'].filter(Boolean).join(' + ')}</span></div></div>}
      <div className="timeline-playhead" style={{ left: `${outputTime / total * 100}%` }}><span /></div>
    </div></div></div>
  </section>;
}
