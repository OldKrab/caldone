import appConfig from '../../../app.json';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  BackHandler,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAppDialog } from '../../components/AppDialog';
import { IconButton, PrimaryButton } from '../../components/controls';
import { KeyboardSafeArea } from '../../components/KeyboardSafeArea';
import { ScreenReveal } from '../../components/ScreenReveal';
import { color, radius, space, type } from '../../design/tokens';
import type { GoalProfile } from '../../domain/goalEstimator';
import type { DailyGoals } from '../../domain/meal';
import type { NotificationPreferences, NutritionUnits } from '../../domain/preferences';
import { formatNumber, locale, t, type Locale } from '../../i18n';
import { SetupScreen } from '../onboarding/SetupScreen';

type SettingsPage = 'root' | 'goals' | 'goal_calculator' | 'units' | 'notifications' | 'language' | 'privacy' | 'about';
type GoalField = keyof DailyGoals;

export function SettingsScreen(props: {
  goals: DailyGoals;
  goalProfile?: GoalProfile;
  units: NutritionUnits;
  notifications: NotificationPreferences;
  locale: Locale;
  includePhotosInExport: boolean;
  importingData: boolean;
  saving: boolean;
  onBack: () => void;
  onManageProvider: () => void;
  onSaveGoalSetup: (profile: GoalProfile, goals: DailyGoals) => Promise<void>;
  onSaveGoals: (goals: DailyGoals) => Promise<void>;
  onSaveUnits: (units: NutritionUnits) => Promise<void>;
  onSaveNotifications: (preferences: NotificationPreferences) => Promise<void>;
  onChangeLocale: (locale: Locale) => Promise<void>;
  onIncludePhotosInExport: (include: boolean) => Promise<void>;
  onExport: () => Promise<void>;
  onImport: () => Promise<void>;
  onExportDiagnostics: () => Promise<void>;
  onRecordNextAnalysis: () => void;
  onClearTestCapture: () => void;
  onRemoveAllPhotos: () => Promise<void>;
  onDeleteAllMeals: () => Promise<void>;
}) {
  const [page, setPage] = useState<SettingsPage>('root');
  const goBack = () => page === 'root' ? props.onBack() : setPage('root');

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page === 'goal_calculator') return false;
      if (page === 'root') props.onBack();
      else setPage('root');
      return true;
    });
    return () => subscription.remove();
  }, [page, props.onBack]);

  if (page === 'goal_calculator') {
    return (
      <SetupScreen
        initialProfile={props.goalProfile}
        recalculating
        saving={props.saving}
        onCancel={() => setPage('goals')}
        onComplete={async (goals, profile) => {
          await props.onSaveGoalSetup(profile, goals);
          setPage('goals');
        }}
      />
    );
  }

  return (
    <KeyboardSafeArea>
      <ScreenReveal>
        {page === 'root' ? (
          <SettingsHub {...props} onBack={goBack} onOpen={setPage} />
        ) : page === 'goals' ? (
          <GoalsPage goals={props.goals} saving={props.saving} onBack={goBack} onRecalculate={() => setPage('goal_calculator')} onSave={props.onSaveGoals} />
        ) : page === 'units' ? (
          <UnitsPage units={props.units} onBack={goBack} onSave={props.onSaveUnits} />
        ) : page === 'notifications' ? (
          <NotificationsPage preferences={props.notifications} onBack={goBack} onSave={props.onSaveNotifications} />
        ) : page === 'language' ? (
          <LanguagePage locale={props.locale} onBack={goBack} onSave={props.onChangeLocale} />
        ) : page === 'privacy' ? (
          <PrivacyPage
            locale={props.locale}
            includePhotos={props.includePhotosInExport}
            onBack={goBack}
            onDeleteAllMeals={props.onDeleteAllMeals}
            onExport={props.onExport}
            onExportDiagnostics={props.onExportDiagnostics}
            onRecordNextAnalysis={props.onRecordNextAnalysis}
            onClearTestCapture={props.onClearTestCapture}
            onImport={props.onImport}
            importing={props.importingData}
            onIncludePhotos={props.onIncludePhotosInExport}
            onRemoveAllPhotos={props.onRemoveAllPhotos}
          />
        ) : (
          <AboutPage onBack={goBack} />
        )}
      </ScreenReveal>
    </KeyboardSafeArea>
  );
}

function SettingsHub(props: Parameters<typeof SettingsScreen>[0] & {
  onBack: () => void;
  onOpen: (page: SettingsPage) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SettingsHeader title={t('settings')} onBack={props.onBack} />
      <SettingsSection title={t('accountAi')}>
        <SettingsLink label={t('aiProvider')} value={props.locale === 'ru' ? 'Подключение и параметры анализа' : 'Connection and analysis settings'} onPress={props.onManageProvider} />
      </SettingsSection>
      <SettingsSection title={t('tracking')}>
        <SettingsLink label={t('dailyGoals')} value={props.goals.calories ? `${formatNumber(props.goals.calories)} ${t('kcal')}` : t('noGoal')} onPress={() => props.onOpen('goals')} />
        <SettingsLink label={t('nutritionUnits')} value={`${props.units.energy} · ${props.units.weight === 'g' ? t('gramsLong') : t('ounces')}`} onPress={() => props.onOpen('units')} />
        <SettingsLink label={t('notifications')} value={t('questionsAndFailures')} onPress={() => props.onOpen('notifications')} />
      </SettingsSection>
      <SettingsSection title={t('appSection')}>
        <SettingsLink label={t('language')} value={props.locale === 'ru' ? 'Русский' : 'English'} onPress={() => props.onOpen('language')} />
        <SettingsLink label={t('dataPrivacy')} value={t('photosKeptWithMeals')} onPress={() => props.onOpen('privacy')} />
        <SettingsLink label={t('aboutCaldone')} value={t('versionLabel', { version: '1.2.0' })} onPress={() => props.onOpen('about')} />
      </SettingsSection>
    </ScrollView>
  );
}

function SettingsHeader(props: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <IconButton icon="arrow-back" label={t('back')} onPress={props.onBack} />
      <Text selectable adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={styles.headerTitle}>{props.title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function SettingsSection(props: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text selectable style={styles.sectionLabel}>{props.title}</Text>
      <View style={styles.panel}>{props.children}</View>
    </View>
  );
}

function SettingsLink(props: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
      <View style={styles.linkCopy}>
        <Text style={styles.linkLabel}>{props.label}</Text>
        <Text numberOfLines={1} style={styles.linkValue}>{props.value}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={color.muted} />
    </Pressable>
  );
}

function GoalsPage(props: { goals: DailyGoals; saving: boolean; onBack: () => void; onRecalculate: () => void; onSave: (goals: DailyGoals) => Promise<void> }) {
  const fields: Array<{ key: GoalField; label: string; unit: string }> = [
    { key: 'calories', label: t('calories'), unit: t('kcal') },
    { key: 'protein', label: t('protein'), unit: t('grams') },
    { key: 'carbs', label: t('carbs'), unit: t('grams') },
    { key: 'fat', label: t('fat'), unit: t('grams') },
  ];
  const [values, setValues] = useState<Record<GoalField, string>>({ calories: '', protein: '', carbs: '', fat: '' });
  const [error, setError] = useState(false);
  useEffect(() => {
    setValues({
      calories: props.goals.calories ? String(props.goals.calories) : '',
      protein: props.goals.protein ? String(props.goals.protein) : '',
      carbs: props.goals.carbs ? String(props.goals.carbs) : '',
      fat: props.goals.fat ? String(props.goals.fat) : '',
    });
  }, [props.goals]);
  const save = async () => {
    const goals = Object.fromEntries(fields.flatMap(({ key }) => {
      const value = Number(values[key].replace(',', '.'));
      return value > 0 ? [[key, value]] : [];
    })) as DailyGoals;
    try {
      setError(false);
      await props.onSave(goals);
      props.onBack();
    } catch {
      setError(true);
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.scroll}>
      <SettingsHeader title={t('dailyGoals')} onBack={props.onBack} />
      <Text selectable style={styles.pageIntro}>{t('goalsQuietHelp')}</Text>
      <View style={styles.formPanel}>
        {fields.map((field) => (
          <View key={field.key} style={styles.settingRow}>
            <Text selectable style={styles.settingLabel}>{field.label}</Text>
            <View style={styles.numberInput}>
              <TextInput
                accessibilityLabel={field.label}
                keyboardType="decimal-pad"
                onChangeText={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
                selectTextOnFocus
                style={styles.numberInputText}
                value={values[field.key]}
              />
              <Text selectable style={styles.numberUnit}>{field.unit}</Text>
            </View>
          </View>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={props.onRecalculate} style={({ pressed }) => [styles.recalculate, pressed && styles.pressed]}>
        <Ionicons name="calculator-outline" size={20} color={color.action} />
        <View style={styles.recalculateCopy}>
          <Text style={styles.recalculateLabel}>{t('recalculateGoals')}</Text>
          <Text style={styles.recalculateHelp}>{t('recalculateGoalsHelp')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={color.muted} />
      </Pressable>
      {error && <Text selectable accessibilityRole="alert" style={styles.error}>{t('goalsError')}</Text>}
      <View style={styles.primaryArea}><PrimaryButton busy={props.saving} label={t('save')} onPress={save} /></View>
    </ScrollView>
  );
}

function UnitsPage(props: { units: NutritionUnits; onBack: () => void; onSave: (units: NutritionUnits) => Promise<void> }) {
  const choose = async <K extends keyof NutritionUnits>(key: K, value: NutritionUnits[K]) => {
    await props.onSave({ ...props.units, [key]: value });
  };
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SettingsHeader title={t('nutritionUnits')} onBack={props.onBack} />
      <Text selectable style={styles.pageIntro}>{t('unitsHelp')}</Text>
      <ChoiceSection title={t('energy')} options={[['kcal', t('kcal')], ['kj', t('kilojoules')]]} selected={props.units.energy} onSelect={(value) => void choose('energy', value as NutritionUnits['energy'])} />
      <ChoiceSection title={t('portionWeight')} options={[['g', t('gramsLong')], ['oz', t('ounces')]]} selected={props.units.weight} onSelect={(value) => void choose('weight', value as NutritionUnits['weight'])} />
    </ScrollView>
  );
}

function ChoiceSection(props: { title: string; options: Array<[string, string]>; selected: string; onSelect: (value: string) => void }) {
  return (
    <View style={styles.choiceSection}>
      <Text selectable style={styles.sectionLabel}>{props.title}</Text>
      <View style={styles.choiceControl}>
        {props.options.map(([value, label]) => (
          <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: props.selected === value }} onPress={() => props.onSelect(value)} style={[styles.choiceButton, props.selected === value && styles.choiceButtonSelected]}>
            <Text style={[styles.choiceText, props.selected === value && styles.choiceTextSelected]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function NotificationsPage(props: { preferences: NotificationPreferences; onBack: () => void; onSave: (preferences: NotificationPreferences) => Promise<void> }) {
  const rows: Array<{ key: keyof NotificationPreferences; label: string; help: string }> = [
    { key: 'questions', label: t('clarificationNotifications'), help: t('clarificationNotificationsHelp') },
    { key: 'failed', label: t('failedNotifications'), help: t('failedNotificationsHelp') },
    { key: 'ready', label: t('readyNotifications'), help: t('readyNotificationsHelp') },
    { key: 'reminder', label: t('reminderNotifications'), help: t('reminderNotificationsHelp') },
  ];
  const toggle = async (key: keyof NotificationPreferences, value: boolean) => {
    await props.onSave({ ...props.preferences, [key]: value });
  };
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SettingsHeader title={t('notifications')} onBack={props.onBack} />
      <Text selectable style={styles.pageIntro}>{t('notificationHelp')}</Text>
      <View style={styles.formPanel}>
        {rows.map((row) => <ToggleRow key={row.key} label={row.label} help={row.help} value={props.preferences[row.key]} onChange={(value) => void toggle(row.key, value)} />)}
      </View>
    </ScrollView>
  );
}

function ToggleRow(props: { label: string; help?: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}><Text selectable style={styles.settingLabel}>{props.label}</Text>{props.help ? <Text selectable style={styles.toggleHelp}>{props.help}</Text> : null}</View>
      <Switch accessibilityLabel={props.label} onValueChange={props.onChange} thumbColor={color.surface} trackColor={{ false: color.line, true: color.action }} value={props.value} />
    </View>
  );
}

function LanguagePage(props: { locale: Locale; onBack: () => void; onSave: (locale: Locale) => Promise<void> }) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SettingsHeader title={t('language')} onBack={props.onBack} />
      <View style={styles.providerChoices}>
        {([['en', 'English'], ['ru', 'Русский']] as const).map(([value, label]) => (
          <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: props.locale === value }} onPress={() => void props.onSave(value)} style={[styles.languageRow, props.locale === value && styles.languageSelected]}>
            <Text style={styles.linkLabel}>{label}</Text>{props.locale === value && <Ionicons name="checkmark" size={20} color={color.action} />}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function PrivacyPage(props: { locale: string; includePhotos: boolean; importing: boolean; onBack: () => void; onIncludePhotos: (include: boolean) => Promise<void>; onExport: () => Promise<void>; onImport: () => Promise<void>; onExportDiagnostics: () => Promise<void>; onRecordNextAnalysis: () => void; onClearTestCapture: () => void; onRemoveAllPhotos: () => Promise<void>; onDeleteAllMeals: () => Promise<void> }) {
  const dialog = useAppDialog();
  const confirmRemoval = (kind: 'photos' | 'data') => dialog.show({
    title: t(kind === 'photos' ? 'removeAllPhotos' : 'deleteAllMealData'),
    message: t(kind === 'photos' ? 'confirmRemovePhotos' : 'confirmDeleteData'),
    actions: [
      { label: t('cancel'), role: 'cancel' },
      { label: t('delete'), role: 'destructive', onPress: () => void (kind === 'photos' ? props.onRemoveAllPhotos() : props.onDeleteAllMeals()) },
    ],
  });
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SettingsHeader title={t('dataPrivacy')} onBack={props.onBack} />
      <Text selectable style={styles.pageIntro}>{t('privacyHelp')}</Text>
      <View style={styles.formPanel}><ToggleRow label={t('includePhotosInExport')} value={props.includePhotos} onChange={(value) => void props.onIncludePhotos(value)} /></View>
      <View style={styles.actionList}>
        <Pressable disabled={props.importing} onPress={() => void props.onImport()} style={[styles.textAction, props.importing && styles.disabled]}><Text style={styles.textActionLabel}>{t(props.importing ? 'importingData' : 'importMyData')}</Text></Pressable>
        <Pressable onPress={() => void props.onExport()} style={styles.textAction}><Text style={styles.textActionLabel}>{t('exportMyData')}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={props.onRecordNextAnalysis} style={styles.textAction}><Text style={styles.textActionLabel}>{props.locale === 'ru' ? 'Записать следующий анализ с фото' : 'Capture next analysis with photo'}</Text></Pressable>
        <Text selectable style={styles.pageIntro}>{props.locale === 'ru' ? 'Тестовая диагностика содержит фото и ответ модели. Хранится только последняя запись.' : 'Test diagnostics include the photo and model response. Only the latest capture is kept.'}</Text>
        <Pressable accessibilityRole="button" onPress={props.onClearTestCapture} style={styles.textAction}><Text style={styles.textActionLabel}>{props.locale === 'ru' ? 'Удалить тестовую запись' : 'Delete test capture'}</Text></Pressable>
        <Pressable onPress={() => void props.onExportDiagnostics()} style={styles.textAction}><Text style={styles.textActionLabel}>{t('saveDiagnostics')}</Text></Pressable>
        <Pressable onPress={() => confirmRemoval('photos')} style={styles.textAction}><Text style={styles.textActionLabel}>{t('removeAllPhotos')}</Text></Pressable>
        <Pressable onPress={() => confirmRemoval('data')} style={styles.textAction}><Text style={styles.dangerLabel}>{t('deleteAllMealData')}</Text></Pressable>
      </View>
    </ScrollView>
  );
}

function AboutPage(props: { onBack: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SettingsHeader title={t('aboutCaldone')} onBack={props.onBack} />
      <Image source={require('../../../assets/caldone-fork-icon.png')} style={styles.aboutMark} />
      <Text selectable style={styles.aboutTitle}>CalDone</Text>
      <Text selectable style={styles.aboutCopy}>{t('aboutBody')}</Text>
      <View style={styles.formPanel}>
        <InfoRow label={t('version')} value={appConfig.expo.version} />
        <InfoRow label={t('openSource')} value="CalDone" />
        <InfoRow label={locale === 'ru' ? 'Лицензия' : 'License'} value="MIT" />
      </View>
    </ScrollView>
  );
}

function InfoRow(props: { label: string; value: string }) {
  return <View style={styles.infoRow}><Text selectable style={styles.linkValue}>{props.label}</Text><Text selectable style={styles.settingLabel}>{props.value}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: color.canvas, flex: 1 },
  scroll: { flex: 1 },
  content: { paddingBottom: space.xxl, paddingHorizontal: 20 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.sm },
  headerTitle: { color: color.ink, flex: 1, fontFamily: type.ticketBold, fontSize: 20, textAlign: 'center' },
  headerSpacer: { width: 48 },
  section: { marginTop: space.lg },
  sectionLabel: { color: color.muted, fontFamily: type.ticketBold, fontSize: 12, letterSpacing: 0.4, marginBottom: 7, marginLeft: 4, textTransform: 'uppercase' },
  panel: { backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  link: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 70, paddingHorizontal: 14, paddingVertical: 10 },
  linkCopy: { flex: 1, minWidth: 0 },
  linkLabel: { color: color.ink, fontFamily: type.ticketBold, fontSize: 15 },
  linkValue: { color: color.muted, fontSize: 12, marginTop: 3 },
  pageIntro: { color: color.muted, fontSize: 15, lineHeight: 22, marginTop: space.md, maxWidth: 350 },
  formPanel: { backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, marginTop: space.lg, overflow: 'hidden', paddingHorizontal: 14 },
  settingRow: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 64, paddingVertical: 9 },
  settingLabel: { color: color.ink, fontFamily: type.ticketBold, fontSize: 15 },
  numberInput: { alignItems: 'center', backgroundColor: color.canvas, borderRadius: radius.control, flexDirection: 'row', height: 48, justifyContent: 'flex-end', minWidth: 122, paddingHorizontal: 12 },
  numberInputText: { color: color.ink, fontFamily: type.ticketBold, fontSize: 17, minWidth: 62, padding: 0, textAlign: 'right' },
  numberUnit: { color: color.muted, fontFamily: type.ticketBold, fontSize: 12, marginLeft: 7 },
  primaryArea: { marginTop: space.lg },
  recalculate: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', marginTop: space.lg, minHeight: 64, paddingHorizontal: 6 },
  recalculateCopy: { flex: 1, marginHorizontal: space.sm, minWidth: 0 },
  recalculateLabel: { color: color.action, fontFamily: type.ticketBold, fontSize: 16 },
  recalculateHelp: { color: color.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  error: { color: color.error, fontSize: 13, marginTop: space.md },
  choiceSection: { marginTop: space.lg },
  choiceControl: { backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', overflow: 'hidden' },
  choiceButton: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 48 },
  choiceButtonSelected: { backgroundColor: color.actionSoft },
  choiceText: { color: color.ink, fontFamily: type.ticketBold, fontSize: 16 },
  choiceTextSelected: { color: color.action },
  toggleRow: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 72, paddingVertical: 10 },
  toggleCopy: { flex: 1, minWidth: 0, paddingRight: space.md },
  toggleHelp: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  providerChoices: { gap: space.sm, marginTop: space.lg },
  languageRow: { alignItems: 'center', backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 62, paddingHorizontal: 14 },
  languageSelected: { borderColor: color.action },
  actionList: { borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.lg, paddingTop: space.sm },
  textAction: { borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: 52, paddingHorizontal: 6 },
  textActionLabel: { color: color.action, fontFamily: type.ticketBold, fontSize: 15 },
  dangerLabel: { color: color.error, fontFamily: type.ticketBold, fontSize: 15 },
  confirmPanel: { backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, marginTop: space.lg, padding: space.md },
  confirmText: { color: color.ink, fontFamily: type.ticketBold, fontSize: 17 },
  confirmActions: { flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end', marginTop: space.md },
  confirmButton: { justifyContent: 'center', minHeight: 44, paddingHorizontal: space.md },
  confirmCancel: { color: color.muted, fontFamily: type.ticketBold, fontSize: 15 },
  deleteButton: { backgroundColor: color.error, borderRadius: radius.control, justifyContent: 'center', minHeight: 44, paddingHorizontal: space.md },
  deleteButtonText: { color: color.surface, fontFamily: type.ticketBold, fontSize: 15 },
  aboutMark: { alignItems: 'center', backgroundColor: color.rail, borderRadius: radius.surface, height: 64, justifyContent: 'center', marginTop: space.xl, width: 64 },
  aboutTitle: { color: color.ink, fontFamily: type.ticketBold, fontSize: 34, marginTop: space.md },
  aboutCopy: { color: color.muted, fontSize: 15, lineHeight: 22, marginTop: space.sm, maxWidth: 340 },
  infoRow: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 54 },
  pressed: { backgroundColor: color.surfacePressed },
  disabled: { opacity: 0.45 },
});
