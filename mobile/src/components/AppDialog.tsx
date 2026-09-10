import { Ionicons } from '@expo/vector-icons';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { color, radius, space, type } from '../design/tokens';
import { t } from '../i18n';
import {
  createAppDialogController,
  type AppDialog,
  type AppDialogController,
} from './appDialogController';

const AppDialogContext = createContext<AppDialogController | undefined>(undefined);

export function AppDialogProvider(props: { children: ReactNode }) {
  const controller = useRef(createAppDialogController()).current;
  const [dialog, setDialog] = useState<AppDialog>();
  useEffect(() => controller.subscribe(setDialog), [controller]);

  return (
    <AppDialogContext.Provider value={controller}>
      {props.children}
      <Modal
        animationType="fade"
        navigationBarTranslucent
        onRequestClose={controller.dismiss}
        statusBarTranslucent
        transparent
        visible={Boolean(dialog)}
      >
        <View accessibilityViewIsModal style={styles.backdrop}>
          <Pressable accessibilityLabel={t('close')} accessibilityRole="button" onPress={controller.dismiss} style={StyleSheet.absoluteFill} />
          <SafeAreaView edges={['left', 'right', 'bottom']} pointerEvents="box-none" style={styles.safeArea}>
            {dialog && (
              <View style={styles.sheet}>
                <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.heading}>
                  <Text selectable accessibilityRole="header" style={styles.title}>{dialog.title}</Text>
                  {dialog.message ? <Text selectable style={styles.message}>{dialog.message}</Text> : null}
                </ScrollView>
                <View style={styles.actions}>
                  {dialog.actions.map((action, index) => (
                    <Pressable
                      accessibilityRole="button"
                      key={`${action.label}-${index}`}
                      onPress={() => controller.choose(index)}
                      style={({ pressed }) => [
                        styles.action,
                        action.role === 'cancel' && styles.cancelAction,
                        pressed && styles.actionPressed,
                      ]}
                    >
                      <Text style={[
                        styles.actionLabel,
                        action.role === 'destructive' && styles.destructiveLabel,
                        action.role === 'cancel' && styles.cancelLabel,
                      ]}>{action.label}</Text>
                      {action.role !== 'cancel' && (
                        <Ionicons name="chevron-forward" size={18} color={action.role === 'destructive' ? color.error : color.muted} />
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </AppDialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogController {
  const controller = useContext(AppDialogContext);
  if (!controller) throw new Error('useAppDialog must be used inside AppDialogProvider');
  return controller;
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(30, 33, 38, 0.58)', flex: 1, justifyContent: 'flex-end' },
  // The sheet's percentage height needs a screen-sized parent; an auto-height
  // parent shrinks even short notices and clips their message behind the actions.
  safeArea: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', padding: space.md },
  sheet: {
    backgroundColor: color.surface,
    borderRadius: radius.surface,
    maxWidth: 480,
    maxHeight: '82%',
    overflow: 'hidden',
    shadowColor: color.ink,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 8,
    width: '100%',
  },
  heading: { paddingHorizontal: space.md, paddingBottom: space.md, paddingTop: 20 },
  title: { color: color.ink, fontFamily: type.ticketBold, fontSize: 25, lineHeight: 29 },
  message: { color: color.muted, fontSize: 15, lineHeight: 21, marginTop: space.sm },
  actions: { borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth },
  action: {
    alignItems: 'center',
    borderBottomColor: color.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: space.md,
  },
  cancelAction: { borderBottomWidth: 0 },
  actionPressed: { backgroundColor: color.surfacePressed },
  actionLabel: { color: color.ink, flex: 1, fontFamily: type.ticketBold, fontSize: 18 },
  destructiveLabel: { color: color.error },
  cancelLabel: { color: color.muted, textAlign: 'center' },
});
