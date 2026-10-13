import type { StreamProfilesModel } from '../src/hooks/useStreamProfiles';
import { DEFAULT_STREAM_ENCODING } from '../shared/streaming';

export function emptyStreamProfiles(): StreamProfilesModel {
  return { profiles: [], selected: '', draft: { ...DEFAULT_STREAM_ENCODING, name: '', server: '', key: '' },
    busy: false, dirty: false, error: undefined, ready: false, change: () => {},
    select: async () => {}, save: async () => {}, remove: async () => {} };
}
