import { requireNativeModule } from 'expo-modules-core';
export const Processing = requireNativeModule<{ start(title: string, body: string): Promise<void>; stop(): Promise<void> }>('CalDoneProcessing');
