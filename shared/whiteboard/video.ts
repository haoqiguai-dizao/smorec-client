import type { Project } from '../types';
import { frameContentAt } from '../frame-content';
import { boardLayoutAt } from './layout';
export { boardLayoutAt } from './layout';

/** Evaluate at source time, including trimmed clips and presenter compositions. */
export function boardVideoVisible(project: Project, time: number): boolean {
  if (!project.whiteboard || project.whiteboard.interfaceCapture === 'screen') return false;
  const board = boardLayoutAt(project.whiteboard, time), content = frameContentAt(project, time);
  return (!content.embeddedInterface || !!project.whiteboard.separateCanvas) && !!board?.visible
    && board.presentation === 'interface' && (content.screen || content.presenter);
}

/** Presenter hides the screen but still needs its embedded whiteboard pixels. */
export function embeddedBoardVisible(project: Project, time: number): boolean {
  if (project.whiteboard?.interfaceCapture !== 'screen') return false;
  const board = boardLayoutAt(project.whiteboard, time);
  return !!board?.visible && board.presentation === 'interface' && frameContentAt(project, time).presenter;
}
