import { ChevronDown, Hand, LocateFixed, Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import type { useWhiteboard } from '../../hooks/useWhiteboard';
import type { useWhiteboardCanvas } from '../../hooks/useWhiteboardCanvas';
import type { BoardBackdrop, BoardWindowOptions } from '../../../shared/whiteboard/types';
import type { BoardTool } from './WhiteboardTools';
import { WhiteboardSceneControls } from './WhiteboardSceneControls';
import { WhiteboardWindowControls } from './WhiteboardWindowControls';

interface Props {
  board: ReturnType<typeof useWhiteboard>; camera: boolean; enabled: boolean; tool: BoardTool;
  viewport: ReturnType<typeof useWhiteboardCanvas>['viewport'];
  onCommitText(): void;
  onTool(value: BoardTool): void;
  onBackdrop(value: BoardBackdrop, shade?: number): void;
  onWindowOptions(value: Partial<BoardWindowOptions>): void;
  onRestore(): void;
  onHide(): void;
}
export function WhiteboardHeader({ board, camera, enabled, tool, viewport, onCommitText, onTool,
  onBackdrop, onWindowOptions, onRestore, onHide }: Props) {
  return <header className="board-header" onPointerDownCapture={onCommitText}><div className="board-move" title="拖动白板"><span>白板</span><i aria-hidden="true" /></div>
      <WhiteboardSceneControls backdrop={camera ? 'camera' : 'white'} returnDisabled={!board.ready || !board.state?.available} shade={board.state?.shade} disabled={!enabled}
        cameraAvailable={!!board.state?.camera?.cameraAvailable && !!board.state?.camera?.cameraVisible}
        presentation={board.state?.presentation} onChoose={window.whiteboard?.chooseMode ? () => void board.chooseMode() : undefined}
        onChange={onBackdrop} />
      {(!window.whiteboard?.chooseMode || board.state?.demoVisible) && <span className="board-output-mode" title={board.state?.demoVisible ? '演示模式按实际界面录制；关闭演示后恢复所选录制模式' : board.state?.presentation === 'interface'
        ? '回放和导出包含白板工具栏与操作过程' : '回放和导出仅包含画布内容，操作工具不进入成片'}>
        {board.state?.demoVisible ? '演示模式 · 实际界面录制' : board.state?.presentation === 'interface' ? '完整界面' : '纯画布'}</span>}
      <div className="board-view-tools" role="group" aria-label="画布视角">
        <button aria-label="移动画布" title="移动画布 · 空格拖拽 / 中键拖拽" aria-pressed={tool === 'hand'} disabled={!enabled}
          onClick={() => onTool(tool === 'hand' ? 'pen' : 'hand')}><Hand size={15} /></button>
        <button aria-label="缩小画布" title="缩小 · 触控板捏合 / ⌘或Ctrl+滚轮" disabled={!enabled || (board.scene.view?.zoom ?? 1) <= .1}
          onClick={() => viewport.zoom(1 / 1.25)}><Minus size={15} /></button>
        <button className="board-zoom-value" aria-label="恢复画布100%缩放" title="恢复100%缩放" disabled={!enabled}
          onClick={viewport.reset}>{Math.round((board.scene.view?.zoom ?? 1) * 100)}%</button>
        <button aria-label="放大画布" title="放大画布" disabled={!enabled || (board.scene.view?.zoom ?? 1) >= 8}
          onClick={() => viewport.zoom(1.25)}><Plus size={15} /></button>
        <button aria-label="回到内容" title="回到内容" disabled={!enabled} onClick={viewport.fit}><LocateFixed size={15} /></button>
      </div>
      <WhiteboardWindowControls options={board.state?.windowOptions} disabled={!enabled} demoVisible={board.state?.demoVisible} camera={camera}
        transparencySupported={board.state?.presentation !== 'interface' || !!board.state?.interfaceTransparencySupported}
        onChange={onWindowOptions} />
      <button aria-label={camera ? '还原普通白板' : board.state?.maximized ? '还原白板' : '铺满录制区域'}
        className={camera || board.state?.maximized ? 'board-restore' : undefined}
        title={camera || board.state?.maximized ? '还原白板 · Esc' : '铺满录制区域'} disabled={!board.ready || !board.state?.available}
        onClick={onRestore}>
        {camera || board.state?.maximized ? <><Minimize2 size={16} /><span>还原</span></> : <Maximize2 size={16} />}</button>
      <button aria-label="收起白板" title="收起白板 · Esc" onClick={onHide}><ChevronDown size={17} /></button></header>;
}
