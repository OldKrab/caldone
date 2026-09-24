import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { color, radius, space } from '../design/tokens';
import { formatQuestionAnswers, questionAnswerReferences, type QuestionChoices } from '../domain/questionChoices';
import type { QuestionAnswer } from '../domain/chat';
import { locale, t } from '../i18n';

/** Local choices are drafts. Only Send submits them through the normal answer path. */
export function QuestionAnswers(props: {
  questions: QuestionChoices[];
  disabled?: boolean;
  onSubmit: (answer: string, references?: QuestionAnswer[]) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const submitting = useRef(false);
  const disabled = props.disabled || sending;
  const answer = formatQuestionAnswers(props.questions, answers);
  const notSure = locale === 'ru' ? 'Не знаю' : 'Not sure';
  const submit = async () => {
    if (disabled || submitting.current || !answer) return;
    submitting.current = true;
    setSending(true);
    setError(false);
    try {
      await props.onSubmit(answer, questionAnswerReferences(props.questions,answers));
      setAnswers({});
      setCustom({});
    } catch {
      // Keep selections available for retry; never silently discard an unsent answer.
      setError(true);
    } finally {
      submitting.current = false;
      setSending(false);
    }
  };
  return <View style={styles.root}>
    {props.questions.map(({ id, question, options }) => { const key=id??question; return <View key={key} style={styles.question}>
      <Text selectable style={styles.title}>{question}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={question} style={styles.options}>
        {[...new Set([...options, notSure])].map(option => {
          const selected = custom[key] !== true && answers[key] === option;
          return <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: Boolean(disabled) }} disabled={disabled}
            onPress={() => { setAnswers(current => ({ ...current, [key]: option })); setCustom(current => ({ ...current, [key]: false })); }}
            style={({ pressed }) => [styles.option, selected && styles.selected, pressed && styles.pressed, disabled && styles.disabled]}>
            <Text style={[styles.optionText, selected && styles.selectedText]}>{option}</Text>
          </Pressable>;
        })}
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: custom[key] === true, disabled: Boolean(disabled) }} disabled={disabled}
          onPress={() => { if (custom[key] === true) return; setCustom(current => ({ ...current, [key]: true })); setAnswers(current => ({ ...current, [key]: '' })); }}
          style={({ pressed }) => [styles.option, custom[key] === true && styles.selected, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={[styles.optionText, custom[key] === true && styles.selectedText]}>{locale === 'ru' ? 'Другой ответ' : 'Custom answer'}</Text>
        </Pressable>
      </View>
      {custom[key] === true && <TextInput accessibilityLabel={question} editable={!disabled} multiline
        value={typeof answers[key] === 'string' ? answers[key] : ''} onChangeText={value => setAnswers(current => ({ ...current, [key]: value }))}
        placeholder={t('answerPlaceholder')} placeholderTextColor={color.muted} style={styles.input} />}
    </View>})}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled || !answer) }} disabled={disabled || !answer}
      onPress={() => void submit()} style={({ pressed }) => [styles.send, pressed && styles.sendPressed, (disabled || !answer) && styles.disabled]}>
      <Text style={styles.sendText}>{sending ? (locale === 'ru' ? 'Отправляю…' : 'Sending…') : (locale === 'ru' ? 'Отправить ответы' : 'Send answers')}</Text>
    </Pressable>
    {error && <Text selectable accessibilityRole="alert" style={styles.error}>{t('notificationAnswerError')}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  question: { gap: space.sm },
  title: { color: color.ink, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option: { minHeight: 48, minWidth: 48, maxWidth: '100%', justifyContent: 'center', borderWidth: 1, borderColor: color.line, borderRadius: radius.control, paddingHorizontal: 12, paddingVertical: 10 },
  selected: { backgroundColor: color.actionSoft, borderColor: color.action },
  optionText: { color: color.ink, fontSize: 15, lineHeight: 21, flexShrink: 1 },
  selectedText: { color: color.action, fontWeight: '600' },
  pressed: { backgroundColor: color.surfacePressed },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.line, borderRadius: radius.control, padding: 12, color: color.ink, fontSize: 15, lineHeight: 21 },
  send: { minHeight: 48, borderRadius: radius.control, backgroundColor: color.action, justifyContent: 'center', alignItems: 'center', padding: 12 },
  sendPressed: { backgroundColor: color.actionPressed },
  sendText: { color: color.surface, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  error: { color: color.error, fontSize: 14, lineHeight: 20 },
});
