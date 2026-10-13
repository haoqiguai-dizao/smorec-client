import { useEffect, useState } from 'react';
import { CircleAlert, Mic } from 'lucide-react';
import type { BoardSpeechModelState } from '../../../shared/whiteboard/types';
import { WhiteboardModelProgress } from './WhiteboardModelProgress';
import type { SpeechPhase } from '../../hooks/useWhiteboardSpeech';
import { useWhiteboardSpeechLevel } from '../../hooks/useWhiteboardSpeechLevel';

interface Props {
  phase: SpeechPhase; session?: string; clipId?: string; error?: string;
  model?: BoardSpeechModelState;
  install: () => Promise<void>; cancel: () => void;
}
export function WhiteboardSpeechStatus({ phase, session, clipId, error, model, install, cancel }: Props) {
  const [delayed, setDelayed] = useState<SpeechPhase>();
  const levels = useWhiteboardSpeechLevel(session, clipId, phase === 'recording');
  useEffect(() => {
    setDelayed(undefined);
    if (phase !== 'preparing' && phase !== 'recognizing') return;
    const timer = setTimeout(() => setDelayed(phase), phase === 'preparing' ? 500 : 250);
    return () => clearTimeout(timer);
  }, [phase]);
  if (phase === 'idle' || ((phase === 'preparing' || phase === 'recognizing') && delayed !== phase)) return null;
  return <div className="board-speech-status" role="status" aria-live="polite">
    {phase === 'recording' ? <><Mic size={15} aria-hidden="true" />
      <div className="board-speech-wave" aria-hidden="true">{levels.map((level, index) =>
        <i key={index} style={{ height: 3 + level * 21 }} />)}</div><span>正在输入 · 松开写入</span></>
      : phase === 'needs-model' ? <>{(error || model?.error) && <span className="board-model-error" title={error ?? model?.error}
        aria-label={`下载失败：${error ?? model?.error}`}><CircleAlert size={15} /></span>}
        <button onClick={() => { void install(); }}>{error || model?.error ? '下载失败，重试' : '下载本机语音模型'}</button></>
        : phase === 'installing' ? <WhiteboardModelProgress model={model} />
          : phase === 'preparing' ? <span>语音录入尚未就绪…</span>
            : phase === 'recognizing' ? <span>正在识别…</span> : <span>{error}</span>}
    {['preparing', 'recognizing'].includes(phase) && <button type="button" onClick={cancel}>取消</button>}
  </div>;
}
