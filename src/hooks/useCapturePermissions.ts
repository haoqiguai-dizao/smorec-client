import { useEffect, useRef, useState } from 'react';
import type { MacPermission } from '../../shared/platform-permissions';
import { useMacPermissions } from './useMacPermissions';
import { capturePermissionNeeds, capturePermissionState } from '../services/capture-permissions';

export function useCapturePermissions(options: {
  enabled: boolean; camera: boolean; microphone: boolean; inputRecording?: boolean; expanded: boolean; restored(): void;
}) {
  const permissions = useMacPermissions(options.expanded, options.enabled);
  const needs = capturePermissionNeeds(options.camera, options.microphone, options.inputRecording);
  const state = capturePermissionState(needs, permissions.status);
  const previousReady = useRef<boolean | null>(null);
  const [guide, setGuide] = useState<MacPermission | null>(null);
  const restored = useRef(options.restored); restored.current = options.restored;
  useEffect(() => {
    if (permissions.loading) return;
    if (permissions.error) { previousReady.current = false; return; }
    if (!permissions.status) return;
    if (options.enabled && state.ready && previousReady.current === false) restored.current();
    previousReady.current = state.ready;
  }, [options.enabled, state.ready, permissions.status, permissions.loading, permissions.error]);
  useEffect(() => {
    if (guide && !permissions.loading && !permissions.error && permissions.status?.some(item => item.kind === guide && item.granted)) {
      setGuide(null); restored.current();
    }
  }, [guide, permissions.status, permissions.loading, permissions.error]);
  return { ...permissions, ...state, needs, enabled: options.enabled,
    guide, openGuide: setGuide, closeGuide: () => setGuide(null),
    ready: state.ready && !permissions.loading && !permissions.error,
    blocked: options.enabled && !permissions.loading && (!state.ready || !!permissions.error) };
}
export type CapturePermissions = ReturnType<typeof useCapturePermissions>;
