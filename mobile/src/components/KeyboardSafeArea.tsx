import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { color } from '../design/tokens';
import { keyboardSafeAreaConfig } from './adaptiveScreen';

export function KeyboardSafeArea(props: PropsWithChildren<{ backgroundColor?: string; style?: ViewStyle }>) {
  const config = keyboardSafeAreaConfig(Platform.OS);

  return (
    <SafeAreaView edges={[...config.edges]} style={[styles.safeArea, { backgroundColor: props.backgroundColor ?? color.canvas }, props.style]}>
      <KeyboardAvoidingView
        behavior={config.behavior}
        keyboardVerticalOffset={config.keyboardVerticalOffset}
        style={styles.fill}
      >
        {props.children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  safeArea: { flex: 1 },
});
