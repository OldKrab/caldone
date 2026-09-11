import { MealWebImage } from '../../components/MealWebImage';
import { mealActivityLabel } from '../../components/MealProgress';
import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton, PrimaryButton } from '../../components/controls';
import { ScreenReveal } from '../../components/ScreenReveal';
import { color, radius, type } from '../../design/tokens';
import { mealQuestions, totalsFor, type DailyGoals, type Meal } from '../../domain/meal';
import { displayEnergy, displayWeight, type NutritionUnits } from '../../domain/preferences';
import { formatDay, formatNumber, formatTime, locale, t } from '../../i18n';
import type { MealActivityStage } from '../../services/mealActivity';

export function HomeScreen(props: {
  answeringMealIds?: ReadonlySet<string>;
  failedDishAdditionIds?: ReadonlySet<string>;
  meals: Meal[];
  activities: ReadonlyMap<string, MealActivityStage>;
  goals: DailyGoals;
  units: NutritionUnits;
  day: number;
  canGoNext: boolean;
  bottomInset?: number;
  onCapture: () => void;
  onOpen: (meal: Meal) => void;
  onMealLongPress: (meal: Meal) => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onRetry: (meal: Meal) => void;
  onAnswer: (meal: Meal, answer: string) => void;
  onAskAssistant: (meal: Meal) => void;
  onSettings: () => void;
}) {
  const totals = totalsFor(props.meals);
  const meals = [...props.meals].sort((a, b) => b.capturedAt - a.capturedAt);
  const isWorking = (meal: Meal) => props.answeringMealIds?.has(meal.id) || props.activities.has(meal.id) || meal.status === 'queued' || meal.status === 'analyzing';
  const attention = meals.filter((m) => !isWorking(m) && (m.status === 'needs_input' || m.status === 'failed'));
  const progress = props.goals.calories ? Math.min(1, totals.calories / props.goals.calories) : 0;
  const unit = props.units.energy === 'kj' ? t('kilojoules') : t('kcal');
  const ru = locale === 'ru';
  const date = new Date(props.day).toLocaleDateString(ru ? 'ru-RU' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
      <ScreenReveal>
        <View style={[styles.screen, { paddingBottom: props.bottomInset ?? 0 }]}>
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text selectable style={styles.title}>{formatDay(props.day)}</Text>
              <Text selectable style={styles.date}>{date}</Text>
            </View>
            <IconButton
              icon="chevron-back"
              label={t('previousDay')}
              onPress={props.onPreviousDay}
            />
            <IconButton
              icon="chevron-forward"
              label={t('nextDay')}
              disabled={!props.canGoNext}
              onPress={props.onNextDay}
            />
            <IconButton icon="settings-outline" label={t('settings')} onPress={props.onSettings} />
          </View>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.budget}>
              <View style={styles.budgetTop}>
                <Text selectable style={styles.budgetTitle}>{ru ? 'Ваш день' : 'Your day'}</Text>
                <Text selectable style={styles.budgetCaption}>
                  {props.goals.calories
                    ? `${formatNumber(displayEnergy(props.goals.calories, props.units))} ${unit} · ${t('goal')}`
                    : t('noGoal')}
                </Text>
              </View>
              <View style={styles.energyLine}>
                <Text selectable style={styles.energy}>
                  {formatNumber(displayEnergy(totals.calories, props.units))}
                  <Text style={styles.energyUnit}> {unit}</Text>
                </Text>
                <Text selectable style={styles.remaining}>
                  {props.goals.calories && totals.calories <= props.goals.calories
                    ? `${formatNumber(displayEnergy(props.goals.calories - totals.calories, props.units))} ${ru ? 'осталось' : 'remaining'}`
                    : ru
                      ? 'Записано за день'
                      : 'Logged today'}
                </Text>
              </View>
              {props.goals.calories ? (
                <View
                  accessibilityRole="progressbar"
                  accessibilityValue={{
                    min: 0,
                    max: props.goals.calories,
                    now: Math.min(totals.calories, props.goals.calories),
                    text: `${formatNumber(displayEnergy(totals.calories, props.units))} / ${formatNumber(displayEnergy(props.goals.calories, props.units))} ${unit}`,
                  }}
                  style={styles.progressTrack}
                >
                  <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                </View>
              ) : null}
              <View style={styles.macros}>
                {(['protein', 'carbs', 'fat'] as const).map((key) => (
                  <View key={key} style={styles.macro}>
                    <Text selectable style={styles.macroLabel}>{t(key)}</Text>
                    <Text selectable style={styles.macroValue}>
                      {formatNumber(displayWeight(totals[key], props.units))}
                      <Text style={styles.macroGoal}>
                        {props.goals[key]
                          ? ` / ${formatNumber(displayWeight(props.goals[key]!, props.units))}`
                          : ''}{' '}
                        {props.units.weight === 'oz' ? t('ounces') : t('grams')}
                      </Text>
                    </Text>
                  </View>
                ))}
              </View>
            </View>
            {attention.length > 0 && (
              <View style={styles.attentionGroup}>
                {attention.map((meal) => (
                  <View
                    key={meal.id}
                    style={[styles.attention, meal.status === 'failed' && styles.failed]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => props.onOpen(meal)}
                      onLongPress={() => props.onMealLongPress(meal)}
                      style={styles.attentionBody}
                    >
                      <Ionicons
                        name={
                          meal.status === 'failed'
                            ? 'alert-circle-outline'
                            : 'chatbubble-ellipses-outline'
                        }
                        size={22}
                        color={meal.status === 'failed' ? color.error : color.pending}
                      />
                      <View style={styles.rowCopy}>
                        <Text style={styles.attentionTitle}>
                          {meal.status === 'failed'
                            ? ru
                              ? 'Нужна повторная попытка'
                              : 'Let’s try this meal again'
                            : ru
                              ? 'Вопрос о еде'
                              : 'A question about your meal'}
                        </Text>
                        <Text numberOfLines={2} style={styles.attentionText}>
                          {mealQuestions(meal.analysis?.clarification)[0] ??
                            meal.analysis?.title ??
                            t('meal')}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={color.pending} />
                    </Pressable>
                    {meal.status === 'failed' && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => props.onRetry(meal)}
                        style={styles.retry}
                      >
                        <Text style={styles.retryText}>
                          {ru ? 'Повторить анализ' : 'Retry analysis'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )}
            <View style={styles.sectionHeading}>
              <Text selectable style={styles.sectionTitle}>{ru ? 'Приёмы пищи' : 'Meals'}</Text>
              <Text selectable style={styles.count}>{meals.length > 0 ? meals.length : ''}</Text>
            </View>
            {meals.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="restaurant-outline" size={24} color={color.action} />
                </View>
                <Text selectable style={styles.emptyTitle}>
                  {t(props.canGoNext ? 'emptyPastTitle' : 'emptyTitle')}
                </Text>
                <Text selectable style={styles.emptyBody}>
                  {ru
                    ? 'Добавьте еду удобным способом. Детали можно уточнить позже.'
                    : 'Add a meal your way. You can refine the details later.'}
                </Text>
              </View>
            ) : (
              meals.map((meal) => {
                const working = isWorking(meal);
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={meal.id}
                    onPress={() => props.onOpen(meal)}
                    onLongPress={() => props.onMealLongPress(meal)}
                    style={({ pressed }) => [styles.meal, pressed && styles.pressed]}
                  >
                    {meal.photos[0] ? (
                      <Image source={{ uri: meal.photos[0].uri }} style={styles.photo} />
                    ) : meal.analysis?.webImage ? (
                      <MealWebImage key={meal.analysis.webImage.url} image={meal.analysis.webImage} compact />
                    ) : (
                      <View style={styles.textMealMark}>
                        <Ionicons name="restaurant-outline" size={24} color={color.action} />
                      </View>
                    )}
                    <View style={styles.rowCopy}>
                      <Text numberOfLines={2} style={styles.mealTitle}>
                        {meal.analysis?.title ?? t('meal')}
                      </Text>
                      <View style={styles.mealMeta}>
                        <Text style={styles.time}>{meal.analysis?.mealType ? `${t(meal.analysis.mealType)} · ` : ''}{formatTime(meal.capturedAt)}</Text>
                        <Text style={[styles.calories, working && styles.working]}>
                          {working
                            ? mealActivityLabel(props.activities.get(meal.id))
                            : meal.analysis ? `${formatNumber(displayEnergy(meal.analysis.totals.calories, props.units))} ${unit}` : '—'}
                        </Text>
                      </View>
                      {props.failedDishAdditionIds?.has(meal.id) && <Text style={styles.working}>{t('dishNotAdded')}</Text>}
                      {!working && (meal.status === 'needs_input' || meal.status === 'failed') && <Text style={styles.working}>{meal.status === 'failed' ? t('failed') : ru ? 'Предварительно · нужно уточнение' : 'Provisional · needs clarification'}</Text>}
                      {!working && meal.analysis && <Text style={styles.mealMacros}>
                        {(['protein', 'carbs', 'fat'] as const).map((key) => `${ru ? ({ protein: 'Б', carbs: 'У', fat: 'Ж' }[key]) : ({ protein: 'P', carbs: 'C', fat: 'F' }[key])} ${formatNumber(displayWeight(meal.analysis!.totals[key], props.units))} ${props.units.weight === 'oz' ? t('ounces') : t('grams')}`).join(' · ')}
                      </Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={color.steel} />
                  </Pressable>
                );
              })
            )}
          </ScrollView>
          <View style={styles.capture}>
            <PrimaryButton icon="camera-outline" label={t('addMeal')} onPress={props.onCapture} />
          </View>
        </View>
      </ScreenReveal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  mealMacros: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  screen: { backgroundColor: color.canvas, flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  heading: { flex: 1 },
  title: { color: color.ink, fontFamily: type.ticketBold, fontSize: 27, letterSpacing: -0.6 },
  date: { color: color.muted, fontSize: 12, marginTop: 5, textTransform: 'capitalize' },
  content: { paddingHorizontal: 20, paddingBottom: 20 },
  budget: { backgroundColor: color.actionSoft, borderRadius: 22, padding: 20 },
  budgetTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  budgetTitle: { color: color.ink, fontFamily: type.ticket, fontSize: 15 },
  budgetCaption: { color: color.muted, fontSize: 12, flexShrink: 1, textAlign: 'right' },
  energyLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 18,
    gap: 8,
    flexWrap: 'wrap',
  },
  energy: {
    color: color.ink,
    fontFamily: type.ticketBold,
    fontSize: 32,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  energyUnit: { fontSize: 15, letterSpacing: 0, color: color.muted },
  remaining: { color: color.action, fontFamily: type.ticket, fontSize: 13 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C9DDD0',
    overflow: 'hidden',
    marginTop: 14,
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: color.action },
  macros: { flexDirection: 'row', marginTop: 20, gap: 10 },
  macro: { flex: 1 },
  macroLabel: { color: color.muted, fontSize: 12 },
  macroValue: { color: color.ink, fontFamily: type.ticket, fontSize: 16, marginTop: 5 },
  macroGoal: { fontSize: 12, color: color.muted },
  attentionGroup: { gap: 10, marginTop: 18 },
  attention: { backgroundColor: color.attentionSoft, borderRadius: 16 },
  failed: { backgroundColor: color.errorSoft },
  attentionBody: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  attentionTitle: { color: color.ink, fontFamily: type.ticket, fontSize: 14 },
  attentionText: { color: color.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  retry: { padding: 14, paddingTop: 0, alignSelf: 'flex-end', minHeight: 48 },
  retryText: { color: color.error, fontFamily: type.ticket, fontSize: 14 },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 26,
    marginBottom: 8,
  },
  sectionTitle: { color: color.ink, fontFamily: type.ticket, fontSize: 18 },
  count: { color: color.muted, fontSize: 13 },
  meal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  photo: { width: 68, height: 76, borderRadius: 14 },
  textMealMark: {
    width: 68,
    height: 76,
    borderRadius: 14,
    backgroundColor: color.actionSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1 },
  mealTitle: { color: color.ink, fontFamily: type.ticket, fontSize: 16, lineHeight: 22 },
  mealMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  time: { color: color.muted, fontSize: 12 },
  calories: { color: color.ink, fontSize: 12, fontFamily: type.ticket },
  working: { color: color.pending },
  empty: { alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12 },
  emptyIcon: {
    backgroundColor: color.actionSoft,
    height: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    marginBottom: 12,
  },
  emptyTitle: { color: color.ink, fontFamily: type.ticket, fontSize: 20, textAlign: 'center' },
  emptyBody: {
    color: color.muted,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  capture: {
    backgroundColor: color.canvas,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  pressed: { backgroundColor: color.surfacePressed },
});
