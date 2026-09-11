import { Ionicons } from '@expo/vector-icons';
import { Clipboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppDialog } from '../../components/AppDialog';
import { color, space } from '../../design/tokens';
import { locale, t } from '../../i18n';
import { connectionErrorDetails, connectionErrorText } from '../../services/connectionRecovery';

/** Format on display so historical failures get the same summary and details as live ones. */
export function AssistantError(props: { error: string; onRetry?: () => void; retryDisabled?: boolean }) {
  const dialog = useAppDialog();
  const showDetails = () => {
    const details = connectionErrorDetails(props.error);
    dialog.show({
      title: locale === 'ru' ? 'Подробности ошибки' : 'Error details',
      // AppDialog renders selectable native Text; provider markup is never executed.
      message: details,
      actions: [
        {
          label: locale === 'ru' ? 'Скопировать подробности' : 'Copy details',
          // TODO(#62): Replace core Clipboard when upgrading React Native past its removal.
          // It is available in the pinned runtime and avoids a new native dependency here.
          onPress: () => Clipboard.setString(details),
        },
        { label: t('close'), role: 'cancel' },
      ],
    });
  };
  return <View>
    <Text selectable accessibilityRole="alert" style={styles.error}>{connectionErrorText(props.error, locale)}</Text>
    <View style={styles.actions}>
      {props.onRetry && <Pressable accessibilityRole="button" disabled={props.retryDisabled} onPress={props.onRetry}
        style={({ pressed }) => [styles.action, (pressed || props.retryDisabled) && styles.dimmed]}>
        <Ionicons name="refresh-outline" size={18} color={color.action} />
        <Text style={styles.label}>{locale === 'ru' ? 'Повторить' : 'Retry'}</Text>
      </Pressable>}
      <Pressable accessibilityRole="button" onPress={showDetails} style={({ pressed }) => [styles.action, pressed && styles.dimmed]}>
        <Text style={styles.label}>{locale === 'ru' ? 'Подробнее' : 'Show details'}</Text>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  error: { color: color.error, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm },
  action: { minHeight: 48, paddingHorizontal: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { color: color.action, fontSize: 14, flexShrink: 1 },
  dimmed: { opacity: 0.5 },
});
