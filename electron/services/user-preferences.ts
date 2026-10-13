import { app } from 'electron';
import { DesktopPreferences } from './desktop-preferences';

export const userPreferences = new DesktopPreferences(() => app.getPath('userData'));
