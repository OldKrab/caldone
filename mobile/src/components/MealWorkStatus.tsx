import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { color, space } from '../design/tokens';
import { t } from '../i18n';
import type { MealActivityStage } from '../services/mealActivity';

export function mealActivityLabel(stage: MealActivityStage = 'thinking'): string {
  const keys = { reading_photos: 'readingMealPhotos', reviewing_meal: 'reviewingMeal', thinking: 'assistantWorking',
    web_search: 'toolWebSearch', writing_result: 'writingMealResult', saving_result: 'savingMealResult' } as const;
  return t(keys[stage]);
}

/** Saved nutrition remains readable while the conversation continues working. */
export function MealWorkStatus({ stage }: { stage?: MealActivityStage }) {
  return <View style={styles.row}>
    <ActivityIndicator color={color.action} size="small" />
    <Text accessibilityLiveRegion="polite" style={styles.label}>{mealActivityLabel(stage)}</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  label: { color: color.action, fontSize: 15, lineHeight: 21, flexShrink: 1 },
});
