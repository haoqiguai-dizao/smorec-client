import type { Project } from './types';

export type EditorSelection = { kind: 'clip' | 'zoom' | 'composition'; id: string } | null;

export function selectionDeletion(project: Project | null, selection: EditorSelection) {
  if (!project || !selection) return { enabled: false, label: '删除所选内容', reason: '先选择片段或镜头' };
  const items = selection.kind === 'clip' ? project.clips : selection.kind === 'zoom' ? project.zooms : project.compositions;
  const exists = !!items?.some(item => item.id === selection.id);
  const label = selection.kind === 'clip' ? '删除片段' : selection.kind === 'zoom' ? '删除镜头' : '删除局部镜头';
  const lastClip = selection.kind === 'clip' && project.clips.length <= 1;
  return { enabled: exists && !lastClip, label, reason: lastClip ? '至少保留一个视频片段' : exists ? '' : '所选内容已不存在' };
}
