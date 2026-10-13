import { useEffect, useRef, useState } from 'react';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import { CaptureRecoveryPanel } from './CaptureRecoveryPanel';

/** Launcher owns feature choices; the separate native companion owns the Settings guide. */
export function PermissionGuide({ model: m, mode = 'record' }: { model: RecorderLauncherModel; mode?: 'record' | 'live' }) {
  const current = useRef(m); current.current = m;
  const [error, setError] = useState('');
  const kind = useRef(m.permissions.guide ?? m.permissions.unresolved[0] ?? 'input').current;
  const needsKey = m.permissions.needs.join(',');
  const inputDisabled = m.inputNeedsConfirmation || !m.inputRecording && (kind === 'input' || kind === 'accessibility');
  useEffect(() => {
    let active = true;
    const api = window.permissionGuide;
    if (!api) { setError('授权引导暂不可用，请重新打开小录'); return; }
    const off = api.onAction(action => {
      const model = current.current;
      if (action === 'enable-input') { model.setInputRecording(true); void model.permissions.refresh(); return; }
      if (action === 'skip-input') model.skipInputRecording();
      if (action === 'disable-camera') model.camera.onEnabledChange(false);
      if (action === 'disable-microphone') model.setMicrophone(false);
      model.permissions.closeGuide(); model.setPanel(null); model.clearError(); void model.permissions.refresh();
    });
    void api.show({ kind, needs: current.current.permissions.needs, mode, inputDisabled }).catch(cause => {
      if (!active) return;
      setError(String(cause)); void window.recorder?.setExpanded(true);
    });
    return () => { active = false; off(); void api.dismiss().catch(() => undefined); };
  }, [kind, needsKey, mode, inputDisabled]);
  return error ? <CaptureRecoveryPanel label="授权引导" close={() => m.setPanel(null)}><p role="alert">{error}</p></CaptureRecoveryPanel> : null;
}
