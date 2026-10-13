import { Check, CircleHelp, Edit3, Pause, Play, RotateCcw, X } from 'lucide-react';
import type { TeleprompterController } from '../../hooks/useTeleprompter';
import { TELEPROMPTER_TEXT_LIMIT } from '../../services/teleprompter-preferences';
import './teleprompter.css';

export function Teleprompter({ controller }: { controller: TeleprompterController }) {
  const cue = controller;
  if (!cue.visible) return null;
  const playLabel = cue.canEdit ? cue.playing ? '暂停试读' : '开始试读' : cue.playing ? '暂停提词' : '开始提词';
  return <section className={`teleprompter ${cue.editing ? 'editing' : ''}`} aria-label="口播提词器">
    <header><span>{cue.waiting ? cue.countdown ? `即将开始 · ${cue.countdown}` : '准备录制' : cue.canEdit ? '录前准备' : '提词器'}</span><div>
      {cue.canEdit && <span className="teleprompter-help" tabIndex={0} aria-label="提词准备说明" title="手动滚动选择起读位置，试读不会改变起点。倒计时结束后自动开始提词。"><CircleHelp size={14} /></span>}
      {cue.canEdit && !cue.editing && <button type="button" aria-label="编辑文稿" title="编辑文稿" onClick={cue.edit}><Edit3 size={14} /></button>}
      <button type="button" aria-label="关闭提词器" title="关闭提词器" onClick={cue.close}><X size={15} /></button>
    </div></header>
    {cue.editing ? <>
      <textarea aria-label="提词文稿" placeholder="粘贴或输入口播文稿…" maxLength={TELEPROMPTER_TEXT_LIMIT}
        value={cue.text} onChange={event => cue.update({ text: event.target.value })} autoFocus spellCheck={false} />
      <footer className="teleprompter-edit-actions"><span>{cue.text.length.toLocaleString()} / 20,000</span>
        <button type="button" className="teleprompter-done" aria-label="完成文稿编辑" disabled={!cue.hasText} onClick={cue.finishEditing}><Check size={14} />准备好了</button></footer>
    </> : !cue.hasText ? <div className="teleprompter-empty">未准备文稿</div> : <>
      <div className="teleprompter-viewport" ref={cue.viewport} tabIndex={0} aria-label="提词文稿阅读区" onScroll={cue.onScroll}
        style={{ fontSize: cue.fontSize }}><div className="teleprompter-script">{cue.text}</div></div>
      <footer className="teleprompter-playback">
        <button type="button" className="teleprompter-play" aria-label={playLabel} aria-pressed={cue.playing} disabled={cue.waiting}
          title={playLabel} onClick={cue.togglePlaying}>{cue.playing ? <Pause size={14} /> : <Play size={14} />}<span>{cue.playing ? '暂停' : cue.canEdit ? '试读' : '开始'}</span></button>
        <button type="button" aria-label="文稿回到开头" title="回到开头" disabled={cue.waiting} onClick={cue.restart}><RotateCcw size={14} /></button>
        <label><span>速度</span><input type="range" aria-label="提词速度" min="10" max="100" step="5" value={cue.speed}
          disabled={cue.waiting} onChange={event => cue.update({ speed: Number(event.target.value) })} /><output>{cue.speed}</output></label>
        {cue.canEdit && <label><span>字号</span><input type="range" aria-label="提词字号" min="18" max="48" step="2" value={cue.fontSize}
          onChange={event => cue.update({ fontSize: Number(event.target.value) })} /><output>{cue.fontSize}</output></label>}
      </footer>
    </>}
  </section>;
}
