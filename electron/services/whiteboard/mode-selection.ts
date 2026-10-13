import { Menu, type BrowserWindow } from 'electron';
import type { BoardMode } from '../../../shared/whiteboard/types';

/** Local transparency is a window preference, independent of the recorded mode. */
export function chooseBoardMode(window: BrowserWindow, mode: BoardMode, camera: boolean, fullInterface: boolean): Promise<BoardMode | undefined> {
  return new Promise(resolve => {
    let selected: BoardMode | undefined;
    Menu.buildFromTemplate(([
      ['canvas', '纯画布'], ['interface', '完整界面'], ['camera', '摄像头界面'],
    ] as const).map(([value, label]) => ({ label, type: 'radio', checked: value === mode,
      enabled: value === 'camera' ? camera : value === 'interface' ? fullInterface : true,
      click: () => { selected = value; } })))
      .popup({ window, callback: () => resolve(selected) });
  });
}
