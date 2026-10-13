import { app } from 'electron';
import { StreamProfiles } from './profiles';

export const streamProfiles = new StreamProfiles(() => app.getPath('userData'));
