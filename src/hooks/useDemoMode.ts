import { useEffect, useState } from 'react';
import type { DemoState } from '../../shared/demo';
export function useDemoMode() {
  const [state, setState] = useState<DemoState>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const api = window.demo;
    if (!api) return;
    let mounted = true, received = false;
    const remove = api.onState(next => { received = true; if (mounted) setState(next); });
    void api.getState().then(next => { if (mounted && !received) setState(next); })
      .catch(cause => { if (mounted) setError(String(cause)); });
    return () => { mounted = false; remove(); };
  }, []);
  return { state, error: error ?? state?.error, menu: async () => {
    setError(undefined);
    try { await window.demo?.menu(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开演示设置'); }
  } };
}
