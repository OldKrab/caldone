import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { color } from '../design/tokens';
import { locale, t } from '../i18n';
import { getMealActivityDetails, subscribeMealActivity, type MealActivityStage } from '../services/mealActivity';

export function mealActivityLabel(stage?: MealActivityStage): string {
  if (stage === 'reading_photos') return t('readingMealPhotos');
  if (stage === 'reviewing_meal') return t('reviewingMeal');
  if (stage === 'thinking') return t('assistantWorking');
  if (stage === 'web_search') return t('toolWebSearch');
  if (stage === 'writing_result') return t('writingMealResult');
  if (stage === 'saving_result') return t('savingMealResult');
  return t('analyzing');
}

/** Reports only observed stages. Elapsed time is not an estimate of completion. */
export function MealProgress(props: { mealId?: string; stage?: MealActivityStage; previousEstimate?: boolean; label?: string }) {
  const [mountedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const [details, setDetails] = useState(() => props.mealId ? getMealActivityDetails(props.mealId) : undefined);
  useEffect(() => {
    const unsubscribe = subscribeMealActivity(() => setDetails(props.mealId ? getMealActivityDetails(props.mealId) : undefined));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [props.mealId]);
  const seconds = Math.max(0, Math.floor((now - (details?.startedAt ?? mountedAt)) / 1000));
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const stage = details?.stages.at(-1) ?? props.stage;
  const previous = details?.stages.slice(0, -1) ?? [];
  const ru = locale === 'ru';
  return <View style={styles.container}>
    <View style={styles.heading}>
      <ActivityIndicator color={color.action} size="small" />
      <Text selectable accessibilityLiveRegion="polite" style={styles.title}>{props.label ?? mealActivityLabel(stage)}</Text>
      <Text selectable accessibilityLabel={`${ru ? 'Прошло' : 'Elapsed'} ${elapsed}`} style={styles.elapsed}>{elapsed}</Text>
    </View>
    {props.mealId && <Text selectable style={styles.help}>{props.previousEstimate
      ? ru ? 'Пересчёт ещё не завершён. Ниже — предыдущая оценка.' : 'Update in progress. The previous estimate is shown below.'
      : ru ? 'Оценка ещё не готова. Можно продолжать пользоваться приложением.' : 'The estimate is not ready yet. You can continue using the app.'}</Text>}
    {previous.length > 0 && <Text selectable style={styles.help}>{ru ? 'Предыдущие этапы: ' : 'Previous stages: '}{previous.map(mealActivityLabel).join(' → ')}</Text>}
    {seconds >= 45 && <Text selectable style={styles.help}>{ru ? 'Обработка занимает больше времени. Ожидаем результат.' : 'Processing is taking longer. Waiting for the result.'}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', paddingVertical: 12, gap: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, color: color.ink, fontSize: 15, lineHeight: 21 },
  elapsed: { color: color.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  help: { color: color.muted, fontSize: 13, lineHeight: 19 },
});
