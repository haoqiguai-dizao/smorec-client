import type { BoardSpeechModelState } from '../../../shared/whiteboard/types';

export function WhiteboardModelProgress({ model }: { model?: BoardSpeechModelState }) {
  const total = model?.total ?? 0, received = model?.received ?? 0;
  const percent = total ? Math.min(100, Math.floor(received / total * 100)) : 0;
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  return <div className="board-model-download">
    <span>{received >= total && total > 0 ? '校验模型…' : `下载模型 ${percent}%`}
      {total > 0 && <small>{mb(received)} / {mb(total)} MB</small>}</span>
    <div role="progressbar" aria-label="语音模型下载进度" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={total > 0 ? percent : undefined}><i style={{ width: `${percent}%` }} /></div>
  </div>;
}
