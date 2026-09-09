import { requireNativeModule } from 'expo-modules-core';

type CodexLoopbackNativeModule = {
  start(expectedState: string): Promise<void>;
  waitForCode(): Promise<string>;
  cancel(message: string): void;
  close(): void;
};

/** Android-only loopback receiver for OpenAI's fixed Codex OAuth redirect. */
export const CodexLoopback =
  requireNativeModule<CodexLoopbackNativeModule>('CodexLoopback');
