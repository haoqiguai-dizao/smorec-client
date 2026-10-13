import fs from 'node:fs/promises';
import path from 'node:path';
import type { BoardRecording } from '../../../shared/whiteboard/types';
import { parseBoardRecording } from '../../../shared/whiteboard/validation';
import { prepareRecordedBoardVideo } from './prepare-video';

/** Fixed local sidecar, committed by the native writer after its first encoded frame. */
export async function attachRecordedBoardVideo(directory: string, recording: BoardRecording, duration: number): Promise<void> {
  const required = recording.events.some(event => event.action.kind === 'layout'
    && event.action.visible && event.action.presentation === 'interface');
  if (!required) return;
  const file = path.join(directory, 'whiteboard-video.json');
  const stat = await fs.lstat(file).catch(() => undefined);
  if (!stat?.isFile() || stat.size > 1024) throw new Error('完整白板的同步记录缺失，原始素材已保留');
  const value = JSON.parse(await fs.readFile(file, 'utf8')) as { offset?: unknown; capture?: unknown };
  if (value.capture === 'screen') { recording.interfaceCapture = 'screen'; return; }
  await prepareRecordedBoardVideo(directory);
  if (typeof value.offset !== 'number' || !Number.isFinite(value.offset) || value.offset > 0 || value.offset < -86400)
    throw new Error('完整白板的同步时间无效');
  recording.video = { offset: value.offset };
  const geometry = path.join(directory, 'whiteboard-frames.jsonl');
  const geometryStat = await fs.lstat(geometry);
  if (!geometryStat.isFile() || geometryStat.size > 4 * 1024 * 1024) throw new Error('白板窗口尺寸记录无效');
  const data = await fs.readFile(geometry, 'utf8');
  const crops = data.slice(0, data.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const parsed = parseBoardRecording({ events: [], video: { offset: value.offset, crops } }, 86400).video!;
  parsed.crops = parsed.crops!.filter(crop => crop.t <= duration);
  recording.video = parsed;
}
