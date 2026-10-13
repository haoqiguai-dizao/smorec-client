import { useEffect, useState } from 'react';
import type { DistributionSnapshot } from '../../shared/distribution-types';

/** Keeps every updater surface subscribed to the same renderer-side snapshot. */
export function useDistributionSnapshot(): DistributionSnapshot | undefined {
  const [state, setState] = useState<DistributionSnapshot>();
  useEffect(() => {
    const api = window.distribution;
    if (!api) return;
    let active = true;
    const receive = (value: DistributionSnapshot) => { if (active) setState(value); };
    const unsubscribe = api.onChanged(receive);
    void api.state().then(receive).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);
  return state;
}
