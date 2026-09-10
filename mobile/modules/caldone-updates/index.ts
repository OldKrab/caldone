import { requireOptionalNativeModule } from 'expo-modules-core';

export type InstalledApp = { version: string; versionCode: number; supported: boolean; abis: string[] };
export type DownloadRequest = { downloadUrl: string; size: number; sha256: string };
export type InstallState = { status: 'idle' | 'downloading' | 'ready' | 'installing' | 'confirmation' | 'error';
  progress: number; error: string; sha256: string };
export const Updates = requireOptionalNativeModule<{
  installed(): InstalledApp;
  state(): InstallState;
  download(request: DownloadRequest): Promise<void>;
  cancel(): void;
  canInstall(): boolean;
  authorize(): Promise<void>;
  install(): Promise<void>;
  confirm(): Promise<void>;
}>('CalDoneUpdates');
