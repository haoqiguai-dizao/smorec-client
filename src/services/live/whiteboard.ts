import type { LiveBoardFrame } from '../../../shared/live-types';
import type { BoardRecording } from '../../../shared/whiteboard/types';

export class LiveBoardPlayback {
  session = '';
  recording: BoardRecording = { events: [], interfaceCapture: 'screen' };
  ingest(frame?: LiveBoardFrame): boolean {
    if (!frame) return false;
    if (frame.session !== this.session) {
      if (frame.from !== 0) throw new Error('直播白板会话不同步');
      this.session = frame.session;
      this.recording = { events: [], interfaceCapture: 'screen' };
    }
    if (frame.from !== this.recording.events.length) throw new Error('直播白板画面更新中断');
    this.recording.events.push(...frame.events);
    return frame.events.some(event => event.action.kind === 'image' || event.action.kind === 'replace' && event.action.element.kind === 'image');
  }
}
