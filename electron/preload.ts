import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktopApi', {
  isDesktop: true,
  pickFolder: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('desktop:pick-folder', defaultPath),
  openDataDir: (): Promise<boolean> =>
    ipcRenderer.invoke('desktop:open-data-dir'),
  getInfo: (): Promise<{ isDesktop: boolean; version: string; dataDir: string }> =>
    ipcRenderer.invoke('desktop:get-info'),
});
