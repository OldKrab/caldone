import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton, PrimaryButton } from '../../components/controls';
import { color, radius, space, type } from '../../design/tokens';
import { hasMealInput } from '../../ai/mealInput';
import { t } from '../../i18n';

export function DescribeMealScreen(props: {
  addingDish?: boolean;
  onStop?: () => void;
  note: string;
  sending: boolean;
  error?: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSend: () => void;
  onManual?: () => void;
}) {
  return <SafeAreaView style={styles.screen}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <IconButton icon="close" label={t('close')} disabled={props.sending} onPress={props.onCancel} />
        <Text style={styles.title}>{t(props.addingDish ? 'addDish' : 'describeMeal')}</Text>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.help}>{t(props.addingDish ? 'addDishHelp' : 'describeMealHelp')}</Text>
        <Text style={styles.label}>{t('mealDescription')}</Text>
        <TextInput
          autoFocus multiline textAlignVertical="top"
          accessibilityLabel={t('mealDescription')}
          editable={!props.sending} value={props.note} onChangeText={props.onChange}
          placeholder={t('mealDescriptionExample')} placeholderTextColor={color.muted}
          style={styles.input}
        />
        <Text style={styles.hint}>{t('describeMealHint')}</Text>
        {props.error && <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text>}
        {props.addingDish && props.sending && <Text accessibilityLiveRegion="polite" style={styles.hint}>{t('addingDish')}</Text>}
        {props.addingDish && props.sending && <Pressable accessibilityRole="button" onPress={props.onStop} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: color.action, textAlign: 'center' }}>{t('stop')}</Text></Pressable>}
        <PrimaryButton label={t(props.addingDish ? 'addDish' : 'analyzeMeal')} busy={props.sending} disabled={!hasMealInput({ photos: [], note: props.note })} onPress={props.onSend} />
        {props.onManual && <Pressable accessibilityRole="button" disabled={props.sending} onPress={props.onManual} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', opacity: props.sending ? 0.4 : pressed ? 0.7 : 1 })}>
          <Text style={{ color: color.action, textAlign: 'center', fontSize: 14 }}>{t('enterNutritionManually')}</Text>
        </Pressable>}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, minHeight: 60 },
  title: { flex: 1, textAlign: 'center', color: color.ink, fontFamily: type.ticketBold, fontSize: 21 },
  content: { padding: space.lg, gap: space.md },
  help: { color: color.ink, fontSize: 21, lineHeight: 29, marginBottom: space.sm },
  label: { color: color.muted, fontSize: 14 },
  input: { backgroundColor: color.surface, borderColor: color.line, borderWidth: 1, borderRadius: radius.control, minHeight: 150, padding: space.md, fontSize: 17, lineHeight: 25, color: color.ink },
  hint: { color: color.muted, fontSize: 14, lineHeight: 21 },
  error: { color: color.error, fontSize: 14, lineHeight: 21 },
});
