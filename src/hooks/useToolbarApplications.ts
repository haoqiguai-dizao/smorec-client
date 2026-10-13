import { useEffect, useRef } from 'react';
import type { RecorderLauncherModel } from './useRecorderLauncher';
import type { LiveApplicationsModel } from './useLiveApplications';
import type { ToolbarExclusionControl } from '../components/session-controls/types';

/** The badge follows acknowledged selections; opening from compact remembers the return state. */
export function useToolbarApplications(model: RecorderLauncherModel, applications: LiveApplicationsModel,
  disabled: boolean, compact: boolean, collapse: () => void): ToolbarExclusionControl {
  const confirmedCount = useRef<number | undefined>(undefined);
  const returnCompact = useRef(false);
  if (applications.ready) confirmedCount.current = applications.selected.length;
  useEffect(() => {
    if (!model.panel && returnCompact.current) { returnCompact.current = false; collapse(); }
    else if (model.panel && model.panel !== 'applications') returnCompact.current = false;
  }, [model.panel, collapse]);
  const windowSource = model.mode === 'window';
  const title = windowSource ? '窗口采集只包含所选窗口，无需排除其它应用'
    : applications.error ?? (applications.applying ? '正在应用排除设置' : applications.loading ? '正在读取排除应用'
      : confirmedCount.current === undefined ? '打开排除应用' : `已排除 ${confirmedCount.current} 个应用`);
  return { count: confirmedCount.current, pending: applications.loading || applications.applying,
    error: applications.error, disabled: disabled || windowSource, open: model.panel === 'applications', title,
    toggle: () => {
      if (model.panel === 'applications') { model.setPanel(null); return; }
      returnCompact.current = compact; model.setPanel('applications');
    } };
}
