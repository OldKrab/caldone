import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { shouldStackFormFields } from '../../components/adaptiveScreen';
import { IconButton, PrimaryButton } from '../../components/controls';
import { KeyboardSafeArea } from '../../components/KeyboardSafeArea';
import { ScreenReveal } from '../../components/ScreenReveal';
import { color, radius, space, type } from '../../design/tokens';
import { estimateDailyGoals, type GoalProfile } from '../../domain/goalEstimator';
import type { DailyGoals } from '../../domain/meal';
import { locale, t } from '../../i18n';
import { ProviderSetupScreen } from '../provider/ProviderSetupScreen';

type FormValues = {
  age: string;
  heightCm: string;
  weightKg: string;
  sex: GoalProfile['sex'];
  activity: GoalProfile['activity'];
  objective: GoalProfile['objective'];
};
type TargetValues = Record<keyof Required<DailyGoals>, string>;

const initialValues: FormValues = {
  age: '30',
  heightCm: '170',
  weightKg: '70',
  sex: 'female',
  activity: 'moderate',
  objective: 'maintain',
};

export function SetupScreen(props: {
  saving: boolean;
  recalculating?: boolean;
  initialProfile?: GoalProfile;
  onCancel?: () => void;
  onComplete: (goals: DailyGoals, profile: GoalProfile) => Promise<void>;
}) {
  const { fontScale, width } = useWindowDimensions();
  const compact = shouldStackFormFields(width, fontScale);
  const [step, setStep] = useState(0);
  const [welcome, setWelcome] = useState(!props.recalculating);
  const ru = locale === 'ru';
  const [values, setValues] = useState<FormValues>(() =>
    props.initialProfile ? profileToForm(props.initialProfile) : initialValues,
  );
  const [targets, setTargets] = useState<TargetValues>({
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
  });
  const [error, setError] = useState('');
  const totalSteps = props.recalculating ? 4 : 5;

  const estimate = useMemo(() => {
    try {
      return estimateDailyGoals(formToProfile(values));
    } catch {
      return undefined;
    }
  }, [values]);

  const goals = useMemo<DailyGoals>(
    () =>
      Object.fromEntries(
        Object.entries(targets).flatMap(([key, raw]) => {
          const value = Number(raw.replace(',', '.'));
          return value > 0 ? [[key, value]] : [];
        }),
      ),
    [targets],
  );

  const next = () => {
    if (step === 1 && !estimate) {
      setError(t('checkProfileValues'));
      return;
    }
    setError('');
    if (step === 2 && estimate)
      setTargets({
        calories: String(estimate.calories),
        protein: String(estimate.protein),
        carbs: String(estimate.carbs),
        fat: String(estimate.fat),
      });
    if (step === 3 && props.recalculating) {
      void props.onComplete(goals, formToProfile(values)).catch(() => setError(t('goalsError')));
      return;
    }
    setStep((current) => current + 1);
  };

  const goBack = () => {
    if (step > 0) setStep((current) => current - 1);
    else if (props.onCancel) props.onCancel();
    else setWelcome(true);
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (welcome && !props.onCancel) return false;
      goBack();
      return true;
    });
    return () => subscription.remove();
  }, [step, welcome, props.onCancel]);

  if (welcome) {
    return (
      <KeyboardSafeArea>
        <ScreenReveal>
          <ScrollView
            contentContainerStyle={styles.welcomeContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.brandRow}>
              <Image source={require('../../../assets/caldone-fork-icon.png')} style={{ width: 36, height: 36, borderRadius: 10 }} />
              <Text selectable style={styles.brand}>CalDone</Text>
            </View>
            <Text selectable style={styles.welcomeTitle}>
              {ru
                ? 'Еда — часть дня.\nНе целая работа.'
                : 'Food is part of your day.\nNot another job.'}
            </Text>
            <Text selectable style={styles.welcomeBody}>
              {ru
                ? 'Снимок, понятная оценка и дневник, который легко вести.'
                : 'A photo, a clear estimate, and a journal that’s easy to keep.'}
            </Text>
            <View style={styles.welcomeJourney}>
              {(
                [
                  [
                    'camera-outline',
                    ru ? 'Сфотографируйте еду' : 'Take a photo',
                    ru ? 'Или добавьте запись вручную.' : 'Or add a meal by hand.',
                  ],
                  [
                    'nutrition-outline',
                    ru ? 'Посмотрите состав' : 'See the breakdown',
                    ru ? 'Калории, белки, углеводы и жиры.' : 'Calories, protein, carbs and fat.',
                  ],
                  [
                    'chatbubble-outline',
                    ru ? 'Уточните, если нужно' : 'Make it yours',
                    ru
                      ? 'Измените порцию сами или с ассистентом.'
                      : 'Adjust portions yourself or with the assistant.',
                  ],
                ] as const
              ).map(([icon, title, body]) => (
                <View key={icon} style={styles.journeyRow}>
                  <View style={styles.journeyIcon}>
                    <Ionicons name={icon} size={23} color={color.action} />
                  </View>
                  <View style={styles.journeyCopy}>
                    <Text selectable style={styles.journeyTitle}>{title}</Text>
                    <Text selectable style={styles.journeyBody}>{body}</Text>
                  </View>
                </View>
              ))}
            </View>
            <Text selectable style={styles.welcomeNote}>
              {ru
                ? 'Сначала зададим ориентиры и подключим ИИ для анализа. Цели можно изменить позже.'
                : 'First, set your starting goals and connect AI for analysis. You can change your goals later.'}
            </Text>
          </ScrollView>
          <View style={styles.action}>
            <PrimaryButton
              label={ru ? 'Настроить мой дневник' : 'Set up my journal'}
              onPress={() => setWelcome(false)}
            />
          </View>
        </ScreenReveal>
      </KeyboardSafeArea>
    );
  }

  if (step === 4) {
    return (
      <ProviderSetupScreen
        completionLabel={t('finishSetup')}
        onboarding
        onBack={() => setStep(3)}
        onComplete={() => props.onComplete(goals, formToProfile(values))}
      />
    );
  }

  const titles = [
    t('setupGoalTitle'),
    t('setupBasicsTitle'),
    t('setupActivityTitle'),
    t('setupTargetsTitle'),
  ];
  const bodies = [
    t('setupGoalBody'),
    t('setupBasicsBody'),
    t('setupDirectionBody'),
    t('setupTargetsBody'),
  ];

  return (
    <KeyboardSafeArea>
      <View style={styles.progress}>
        {Array.from({ length: totalSteps }, (_, index) => (
          <View
            key={index}
            style={[styles.progressBar, index <= step && styles.progressBarActive]}
          />
        ))}
      </View>
      <ScreenReveal key={step}>
        <View style={styles.stepScreen}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
          >
            <View style={styles.topline}>
              <IconButton icon="arrow-back" label={t('back')} onPress={goBack} />
              <Text selectable style={styles.stepLabel}>
                {t('setupStep', { current: step + 1, total: totalSteps })}
              </Text>
              <View style={styles.backSpacer} />
            </View>
            <View style={styles.stageIcon}>
              <Ionicons
                name={
                  (
                    [
                      'compass-outline',
                      'person-outline',
                      'walk-outline',
                      'checkmark-outline',
                    ] as const
                  )[step]
                }
                size={27}
                color={color.action}
              />
            </View>
            <Text selectable style={[styles.title, compact && styles.titleCompact]}>{titles[step]}</Text>
            <Text selectable style={styles.body}>{bodies[step]}</Text>

            {step === 0 && (
              <ChoiceStack
                options={(['lose', 'maintain', 'gain'] as const).map((value) => [
                  value,
                  t(value),
                  ru
                    ? {
                        lose: 'Постепенно снижать вес',
                        maintain: 'Сохранять привычный баланс',
                        gain: 'Постепенно увеличивать вес',
                      }[value]
                    : {
                        lose: 'Gradually reduce weight',
                        maintain: 'Keep a steady balance',
                        gain: 'Gradually increase weight',
                      }[value],
                ])}
                selected={values.objective}
                onSelect={(objective) =>
                  setValues((current) => ({
                    ...current,
                    objective: objective as GoalProfile['objective'],
                  }))
                }
              />
            )}

            {step === 1 && (
              <>
                <View style={[styles.segment, compact && styles.segmentCompact]}>
                  {(['female', 'male'] as const).map((sex) => (
                    <Choice
                      key={sex}
                      label={t(sex === 'female' ? 'femaleEquation' : 'maleEquation')}
                      selected={values.sex === sex}
                      stacked={compact}
                      onPress={() => setValues((current) => ({ ...current, sex }))}
                    />
                  ))}
                </View>
                <View style={styles.fields}>
                  <NumberField
                    label={t('age')}
                    suffix={t('years')}
                    value={values.age}
                    onChange={(age) => setValues((current) => ({ ...current, age }))}
                  />
                  <NumberField
                    label={t('height')}
                    suffix={t('centimeters')}
                    value={values.heightCm}
                    onChange={(heightCm) => setValues((current) => ({ ...current, heightCm }))}
                  />
                  <NumberField
                    label={t('weight')}
                    suffix={t('kilograms')}
                    value={values.weightKg}
                    onChange={(weightKg) => setValues((current) => ({ ...current, weightKg }))}
                  />
                </View>
                <Text selectable style={styles.scopeNote}>{t('adultEstimateNote')}</Text>
              </>
            )}

            {step === 2 && (
              <ChoiceStack
                options={(['sedentary', 'light', 'moderate', 'very_active'] as const).map(
                  (value) => [
                    value,
                    t(value === 'very_active' ? 'veryActive' : value),
                    ru
                      ? {
                          sedentary: 'Преимущественно сидячий день',
                          light: 'Немного ходьбы и движения',
                          moderate: 'Регулярные прогулки или тренировки',
                          very_active: 'Много движения или интенсивные тренировки',
                        }[value]
                      : {
                          sedentary: 'Mostly seated days',
                          light: 'Some walking and movement',
                          moderate: 'Regular walks or exercise',
                          very_active: 'Physical work or intensive exercise',
                        }[value],
                  ],
                )}
                selected={values.activity}
                onSelect={(activity) =>
                  setValues((current) => ({
                    ...current,
                    activity: activity as GoalProfile['activity'],
                  }))
                }
              />
            )}

            {step === 3 && (
              <View style={styles.fields}>
                {(
                  [
                    ['calories', t('kcal')],
                    ['protein', t('grams')],
                    ['carbs', t('grams')],
                    ['fat', t('grams')],
                  ] as const
                ).map(([field, unit]) => (
                  <NumberField
                    key={field}
                    label={t(field)}
                    suffix={unit}
                    value={targets[field]}
                    onChange={(value) => setTargets((current) => ({ ...current, [field]: value }))}
                  />
                ))}
              </View>
            )}
            {error ? (
              <Text selectable accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
          </ScrollView>
          <View style={styles.action}>
            <PrimaryButton
              busy={props.saving}
              label={props.recalculating && step === 3 ? t('saveGoals') : t('continue')}
              onPress={next}
            />
          </View>
        </View>
      </ScreenReveal>
    </KeyboardSafeArea>
  );
}

function formToProfile(values: FormValues): GoalProfile {
  return {
    age: Number(values.age),
    heightCm: Number(values.heightCm.replace(',', '.')),
    weightKg: Number(values.weightKg.replace(',', '.')),
    sex: values.sex,
    activity: values.activity,
    objective: values.objective,
  };
}

function profileToForm(profile: GoalProfile): FormValues {
  return {
    age: String(profile.age),
    heightCm: String(profile.heightCm),
    weightKg: String(profile.weightKg),
    sex: profile.sex,
    activity: profile.activity,
    objective: profile.objective,
  };
}

function NumberField(props: {
  label: string;
  suffix: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text selectable style={styles.fieldLabel}>{props.label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel={props.label}
          keyboardType="decimal-pad"
          onChangeText={props.onChange}
          selectTextOnFocus
          style={styles.input}
          value={props.value}
        />
        <Text selectable style={styles.suffix}>{props.suffix}</Text>
      </View>
    </View>
  );
}

function ChoiceStack(props: {
  options: ReadonlyArray<readonly [string, string, string?]>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.choiceStack}>
      {props.options.map(([value, label, detail]) => (
        <Choice
          key={value}
          label={label}
          detail={detail}
          selected={props.selected === value}
          onPress={() => props.onSelect(value)}
        />
      ))}
    </View>
  );
}

function Choice(props: {
  label: string;
  detail?: string;
  selected: boolean;
  stacked?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      onPress={props.onPress}
      style={[
        styles.choice,
        props.stacked && styles.choiceStacked,
        props.selected && styles.choiceSelected,
      ]}
    >
      <View style={[styles.radio, props.selected && styles.radioSelected]}>
        {props.selected && <Ionicons name="checkmark" size={15} color={color.surface} />}
      </View>
      <View style={styles.choiceCopy}>
        <Text style={styles.choiceText}>{props.label}</Text>
        {props.detail && <Text style={styles.choiceDetail}>{props.detail}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  welcomeContent: { padding: 24, paddingTop: 28, flexGrow: 1 },
  brandRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  brand: { fontFamily: type.ticket, color: color.ink, fontSize: 21 },
  welcomeTitle: {
    color: color.ink,
    fontFamily: type.ticketBold,
    fontSize: 33,
    lineHeight: 40,
    letterSpacing: -0.7,
    marginTop: 40,
  },
  welcomeBody: { color: color.muted, fontSize: 17, lineHeight: 25, marginTop: 16 },
  welcomeJourney: {
    marginTop: 32,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  journeyRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  journeyIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: color.actionSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  journeyCopy: { flex: 1 },
  journeyTitle: { color: color.ink, fontFamily: type.ticket, fontSize: 16 },
  journeyBody: { color: color.muted, fontSize: 14, lineHeight: 21, marginTop: 4 },
  welcomeNote: { color: color.muted, fontSize: 13, lineHeight: 20, marginTop: 24 },
  stageIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.actionSoft,
    borderRadius: 20,
    width: 60,
    height: 60,
    marginTop: 24,
  },
  choiceCopy: { flex: 1 },
  choiceDetail: { color: color.muted, fontSize: 13, lineHeight: 19, marginTop: 5 },

  progress: { flexDirection: 'row', gap: 6, paddingHorizontal: space.lg, paddingTop: space.md },
  progressBar: { backgroundColor: color.line, borderRadius: 3, flex: 1, height: 4 },
  progressBarActive: { backgroundColor: color.action },
  stepScreen: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.lg },
  topline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  backSpacer: { width: 48 },
  stepLabel: { color: color.muted, fontFamily: type.ticketBold, fontSize: 13, letterSpacing: 0 },
  title: {
    color: color.ink,
    fontFamily: type.ticketBold,
    fontSize: 30,
    lineHeight: 36,
    marginTop: 20,
  },
  titleCompact: { fontSize: 27, lineHeight: 33 },
  body: { color: color.muted, fontSize: 15, lineHeight: 22, marginTop: space.sm, maxWidth: 350 },
  segment: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },
  segmentCompact: { flexDirection: 'column' },
  choiceStack: { gap: space.sm, marginTop: space.xl },
  choice: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 68,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  choiceStacked: { flex: 0 },
  choiceSelected: { backgroundColor: color.actionSoft, borderColor: color.action },
  radio: {
    alignItems: 'center',
    borderColor: color.line,
    borderRadius: radius.round,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  radioSelected: { backgroundColor: color.action, borderColor: color.action },
  choiceText: { color: color.ink, fontFamily: type.ticketBold, fontSize: 16 },
  fields: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: space.xl,
    paddingHorizontal: space.md,
  },
  field: {
    alignItems: 'center',
    borderBottomColor: color.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 76,
  },
  fieldLabel: {
    color: color.ink,
    flexShrink: 1,
    fontFamily: type.ticketBold,
    fontSize: 16,
    marginRight: space.sm,
  },
  inputRow: {
    alignItems: 'center',
    backgroundColor: color.canvas,
    borderRadius: radius.control,
    flexDirection: 'row',
    minHeight: 50,
    justifyContent: 'flex-end',
    minWidth: 112,
    paddingHorizontal: 11,
  },
  input: {
    color: color.ink,
    fontFamily: type.ticketBold,
    fontSize: 15,
    minWidth: 54,
    padding: 0,
    textAlign: 'right',
  },
  suffix: { color: color.muted, fontSize: 12, marginLeft: 7 },
  scopeNote: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: space.md },
  error: { color: color.error, fontSize: 13, marginTop: space.md },
  action: {
    backgroundColor: color.canvas,
    paddingBottom: 16,
    paddingHorizontal: space.lg,
    paddingTop: 12,
  },
});
