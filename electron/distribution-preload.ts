import { contextBridge, ipcRenderer } from 'electron';
import type { DistributionApi, DistributionSnapshot } from '../shared/distribution-types';
const api: DistributionApi = {
  state: () => ipcRenderer.invoke('distribution:state'),
  check: () => ipcRenderer.invoke('distribution:check'),
  restart: () => ipcRenderer.invoke('distribution:restart'),
  openDownload: () => ipcRenderer.invoke('distribution:download'),
  openLicenses: () => ipcRenderer.invoke('distribution:licenses'),
  setTelemetry: enabled => ipcRenderer.invoke('distribution:telemetry', enabled),
  onChanged: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: DistributionSnapshot) => callback(value);
    ipcRenderer.on('distribution:changed', listener);
    return () => { ipcRenderer.removeListener('distribution:changed', listener); };
  },
};
contextBridge.exposeInMainWorld('distribution', api);
