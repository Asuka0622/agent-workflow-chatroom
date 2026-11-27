export interface DesktopApi {
  isDesktop: boolean;
  pickFolder: (defaultPath?: string) => Promise<string | null>;
  openDataDir: () => Promise<boolean>;
  getInfo: () => Promise<{ isDesktop: boolean; version: string; dataDir: string }>;
}

declare global {
  interface Window {
    desktopApi?: DesktopApi;
  }
}

export {};
