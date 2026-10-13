import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import { LauncherSourceTrigger } from './LauncherSourceTrigger';
import { ToolbarExclusions } from '../session-controls/ToolbarExclusions';
import type { ToolbarExclusionControl } from '../session-controls/types';
import './toolbar-picture.css';

export function LauncherPictureControls({ model, exclusion, readOnly = false, compact = false }: {
  model: RecorderLauncherModel; exclusion: ToolbarExclusionControl; readOnly?: boolean; compact?: boolean;
}) {
  return <div className="toolbar-picture" role="group" aria-label="画面来源与排除应用">
    {!compact && <LauncherSourceTrigger model={model} readOnly={readOnly} />}
    <ToolbarExclusions control={exclusion} compact={compact} />
  </div>;
}
