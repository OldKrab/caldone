import { MealWebImage } from '../../components/MealWebImage';
import { MealProgress } from '../../components/MealProgress';
import { QuestionAnswers } from '../../components/QuestionAnswers';
import { canAddDish } from '../../domain/mealAddition';
import { mealQuestionChoices } from '../../domain/mealQuestions';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { shouldStackFormFields } from '../../components/adaptiveScreen';
import { IconButton, PrimaryButton } from '../../components/controls';
import { useAppDialog } from '../../components/AppDialog';
import { KeyboardSafeArea } from '../../components/KeyboardSafeArea';
import { ScreenReveal } from '../../components/ScreenReveal';
import { color, radius, space, type } from '../../design/tokens';
import { mealQuestions, type Meal, type MealAnalysis, type MealItem, type MealType, type NutritionTotals } from '../../domain/meal';
import { displayEnergy, displayWeight, type NutritionUnits } from '../../domain/preferences';
import { caloriesPer100Grams, mealWeightGrams } from '../../domain/mealWeight';
import { formatNumber, formatTime, locale, t } from '../../i18n';
import type { MealActivityStage } from '../../services/mealActivity';

const mealTypes: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const nutritionFields = ['calories', 'protein', 'carbs', 'fat'] as const;
type NutritionField = typeof nutritionFields[number];

export function MealDetailScreen(props: {
  answerSubmitting?: boolean;
  meal: Meal;
  activity?: MealActivityStage;
  units: NutritionUnits;
  initialEditing?: boolean;
  creating?: boolean;
  onBack: () => void;
  onAddDish: () => void;
  onAnswer: (answer: string) => Promise<void>;
  onDelete: () => void;
  onAskAssistant: () => void;
  onSave: (capturedAt: number, analysis: MealAnalysis) => Promise<void>;
}) {
  const dialog = useAppDialog();
  const [editing, setEditing] = useState(Boolean(props.initialEditing));
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<MealAnalysis | undefined>(props.meal.analysis);
  const [time, setTime] = useState(editableTime(props.meal.capturedAt));
  const [answering, setAnswering] = useState(false);
  const working = answering || props.answerSubmitting || Boolean(props.activity) || props.meal.status === 'queued' || props.meal.status === 'analyzing';

  useEffect(() => {
    if (editing) return;
    setDraft(props.meal.analysis ? JSON.parse(JSON.stringify(props.meal.analysis)) as MealAnalysis : undefined);
    setTime(editableTime(props.meal.capturedAt));
  }, [editing, props.meal.analysis, props.meal.capturedAt]);

  const save = async () => {
    if (!draft) return;
    setError('');
    try {
      const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!match) throw new Error('Invalid time');
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (hours > 23 || minutes > 59 || draft.items.some((item) => !item.name.trim())) {
        throw new Error('Invalid meal values');
      }
      const capturedAt = new Date(props.meal.capturedAt);
      capturedAt.setHours(hours, minutes, 0, 0);
      const analysis = { ...draft, totals: sumItems(draft.items), clarification: undefined };
      await props.onSave(capturedAt.getTime(), analysis);
      setEditing(false);
    } catch {
      setError(t('saveChangesError'));
    }
  };

  const submitClarification = async (answer: string) => {
    if (!answer.trim() || answering || props.answerSubmitting) return;
    setAnswering(true);
    setError('');
    try {
      await props.onAnswer(answer.trim());
    } finally {
      setAnswering(false);
    }
  };

  const confirmDelete = () => dialog.show({
    title: t('deleteConfirmTitle'),
    message: t('deleteConfirmBody'),
    actions: [
      { label: t('delete'), role: 'destructive', onPress: props.onDelete },
      { label: t('cancel'), role: 'cancel' },
    ],
  });

  if (!draft) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title={t('mealDetails')} onBack={props.onBack} actionLabel={props.meal.status === 'failed' ? t('delete') : undefined} onAction={confirmDelete} />
        <View style={styles.loading}>
          {props.meal.photos[0] && <Image source={{ uri: props.meal.photos[0].uri }} style={styles.pendingPhoto} />}
          {props.meal.status === 'failed' ? <Text style={styles.loadingText}>{t('failed')}</Text> : <MealProgress mealId={props.meal.id} stage={props.activity} />}
          <Text style={styles.pendingHelp}>{props.meal.status === 'failed' ? (locale === 'ru' ? 'Не удалось получить оценку. Вернитесь к дневнику, чтобы повторить анализ, или удалите запись.' : 'The estimate could not be completed. Return to your journal to retry, or delete this record.') : (locale === 'ru' ? 'Можно вернуться к дневнику. Результат появится в записи.' : 'You can return to your journal. The result will appear in this record.')}</Text>
          <PrimaryButton label={locale === 'ru' ? 'К дневнику' : 'Back to journal'} onPress={props.onBack} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <KeyboardSafeArea>
      <ScreenReveal>
        <Header
          actionLabel={t(editing ? 'cancel' : 'edit')}
          title={props.creating ? t('addMeal') : locale === 'ru' ? (editing ? 'Изменить запись' : 'Приём пищи') : (editing ? 'Edit meal' : 'Meal details')}
          onAction={() => { if (props.creating) return props.onBack(); setEditing((value) => !value); setError(''); }}
          onBack={props.onBack}
        />
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
        >

        {!editing && working && <MealProgress mealId={props.meal.id} stage={props.activity} previousEstimate />}
        {!editing && !working && props.meal.status === 'needs_input' && <Text style={styles.clarificationActivity}>{locale === 'ru' ? 'Предварительная оценка · ожидает уточнения' : 'Provisional estimate · awaiting clarification'}</Text>}
        {!editing && !working && props.meal.status === 'failed' && <Text style={styles.error}>{locale === 'ru' ? 'Пересчёт не завершён. Ниже — предыдущая оценка.' : 'Update failed. The previous estimate is shown below.'}</Text>}
        {!editing && mealQuestions(draft.clarification).length > 0 && (
          // Keep answer draft mounted so a failed request restores the typed answer.
          <View style={[styles.clarification, working && { display: 'none' }]}>
            <Text style={styles.clarificationLabel}>{t('clarificationTitle')}</Text>
            <QuestionAnswers key={`${props.meal.id}-${JSON.stringify(draft.clarification)}`}
              questions={mealQuestionChoices(draft.clarification)} disabled={answering || props.answerSubmitting}
              onSubmit={submitClarification} />
            <Pressable accessibilityRole="button" onPress={props.onAskAssistant} style={styles.answerInChat}>
              <Ionicons name="chatbox-ellipses-outline" size={17} color={color.action} />
              <Text style={styles.answerInChatText}>{t('answerInChat')}</Text>
              <Ionicons name="chevron-forward" size={16} color={color.muted} />
            </Pressable>

          </View>
        )}

        {editing ? (
          <>
            {!props.creating && <Pressable accessibilityRole="button" onPress={props.onAskAssistant} style={styles.editWithAssistant}>
              <View style={styles.editWithAssistantIcon}><Ionicons name="sparkles-outline" size={18} color={color.action} /></View>
              <View style={styles.editWithAssistantCopy}>
                <Text style={styles.editWithAssistantTitle}>{t('editWithAssistant')}</Text>
                <Text style={styles.editWithAssistantHelp}>{t('editWithAssistantHelp')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={color.muted} />
            </Pressable>}
            <MealEditor draft={draft} time={time} onChange={setDraft} onTimeChange={setTime} />
          </>
        ) : (
          <MealOverview meal={props.meal} analysis={draft} units={props.units} />
        )}

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

        {!editing && !props.creating && <View style={{ marginTop: space.lg, gap: space.sm }}>
          <PrimaryButton icon="add" label={t('addDish')} disabled={!canAddDish(props.meal) || props.answerSubmitting || answering} onPress={props.onAddDish} />
          {!canAddDish(props.meal) && <Text style={styles.pendingHelp}>{t('addDishNotReady')}</Text>}
        </View>}
        {!editing && <Pressable accessibilityRole="button" onPress={props.onAskAssistant} style={styles.assistantAction}>
          <Ionicons name="chatbubble-outline" size={19} color={color.action} />
          <Text style={styles.assistantActionText}>{t(draft.clarification ? 'discussInAssistant' : 'askAssistant')}</Text>
          <Ionicons name="chevron-forward" size={17} color={color.muted} />
        </Pressable>}
        </ScrollView>
        {editing && <View style={styles.saveDock}>
          <PrimaryButton label={t(props.creating ? 'addMeal' : 'saveChanges')} onPress={save} />
          {!props.creating && <Pressable accessibilityRole="button" onPress={confirmDelete} style={styles.deleteAction}><Text style={styles.delete}>{t('deleteMeal')}</Text></Pressable>}
        </View>}
      </ScreenReveal>
    </KeyboardSafeArea>
  );
}

function Header(props: {
  title: string;
  onBack: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}><IconButton icon="arrow-back" label={t('back')} onPress={props.onBack} /></View>
      <Text adjustsFontSizeToFit minimumFontScale={0.86} numberOfLines={1} style={styles.headerTitle}>{props.title}</Text>
      {props.actionLabel && props.onAction ? (
        <View style={[styles.headerSide, styles.headerSideEnd]}><Pressable accessibilityRole="button" hitSlop={6} onPress={props.onAction} style={styles.headerActionButton}>
          <Text numberOfLines={1} style={styles.headerAction}>{props.actionLabel}</Text>
        </Pressable></View>
      ) : <View style={styles.headerSide} />}
    </View>
  );
}

function MealOverview(props: { meal: Meal; analysis: MealAnalysis; units: NutritionUnits }) {
  const weight = mealWeightGrams(props.analysis.items.map((item) => item.quantity));
  const dialog = useAppDialog();
  const { fontScale, width } = useWindowDimensions();
  const compact = shouldStackFormFields(width, fontScale);
  const [openPhoto, setOpenPhoto] = useState<string>();
  const photoWidth = props.meal.photos.length === 1 ? Math.min(260, width - 72) : 180;

  const savePhoto = async (uri: string) => {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
      if (!permission.granted) throw new Error('Photo access denied');
      await MediaLibrary.saveToLibraryAsync(uri);
      dialog.show({ title: t('photoSaved'), message: t('photoSavedBody'), actions: [{ label: t('close'), role: 'cancel' }] });
    } catch {
      dialog.show({ title: t('photoActions'), message: t('photoSaveError'), actions: [{ label: t('close'), role: 'cancel' }] });
    }
  };

  const sharePhoto = async (uri: string) => {
    try {
      if (!await Sharing.isAvailableAsync()) {
        dialog.show({ title: t('photoActions'), message: t('shareUnavailable'), actions: [{ label: t('close'), role: 'cancel' }] });
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'image/jpeg' });
    } catch {
      dialog.show({ title: t('photoActions'), message: t('shareUnavailable'), actions: [{ label: t('close'), role: 'cancel' }] });
    }
  };

  const showPhotoActions = (uri: string) => {
    dialog.show({ title: t('photoActions'), actions: [
      { label: t('savePhoto'), onPress: () => void savePhoto(uri) },
      { label: t('sharePhoto'), onPress: () => void sharePhoto(uri) },
      { label: t('cancel'), role: 'cancel' },
    ] });
  };

  return (
    <>
      <View style={styles.detailTicket}>
        <Text style={styles.mealType}>{t(props.analysis.mealType)} · {formatTime(props.meal.capturedAt)}</Text>
        <Text style={styles.title}>{props.analysis.title}</Text>
        <View style={styles.totalRow}>
          <Text style={styles.totalCalories}>{formatNumber(displayEnergy(props.analysis.totals.calories, props.units))} {energyUnit(props.units)}</Text>
          <Text style={styles.totalMacros}>
            {weight === null
              ? (locale === 'ru' ? 'Общая масса не определена' : 'Total weight unavailable')
              : `${locale === 'ru' ? 'Общая масса' : 'Total weight'} ≈ ${formatMacro(weight, props.units)}`}
          </Text>
          <Text style={styles.totalMacros}>
            {t('proteinShort')} {formatMacro(props.analysis.totals.protein, props.units)} · {t('carbsShort')} {formatMacro(props.analysis.totals.carbs, props.units)} · {t('fatShort')} {formatMacro(props.analysis.totals.fat, props.units)}
          </Text>
        </View>
      {props.meal.photos.length > 0 && (
        <ScrollView
          horizontal
          contentContainerStyle={styles.photoGallery}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          snapToInterval={photoWidth + space.sm}
        >
          {props.meal.photos.map((photo, index) => (
            <Pressable
              key={`${photo.uri}-${index}`}
              accessibilityRole="imagebutton"
              accessibilityLabel={`${t('mealPhoto')} ${index + 1}`}
              accessibilityHint={t('photoActions')}
              delayLongPress={350}
              onLongPress={() => showPhotoActions(photo.uri)}
              onPress={() => setOpenPhoto(photo.uri)}
            >
              <Image source={{ uri: photo.uri }} resizeMode="cover" style={[styles.mealPhoto, { width: photoWidth }]} />
              {props.meal.photos.length > 1 && (
                <View style={styles.photoIndex}><Text style={styles.photoIndexText}>{index + 1}/{props.meal.photos.length}</Text></View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}

      {props.meal.photos.length === 0 && props.analysis.webImage && <MealWebImage key={props.analysis.webImage.url} image={props.analysis.webImage} />}

      {props.meal.note.trim() && (
        <View style={styles.noteBlock}>
          <Text style={styles.noteLabel}>{t('yourNote')}</Text>
          <Text style={styles.noteText}>{props.meal.note.trim()}</Text>
        </View>
      )}

        <View style={styles.items}>
          {props.analysis.items.map((item, index) => {
            const per100g = caloriesPer100Grams(item.calories, item.quantity);
            return (
            <View key={`${item.name}-${index}`} style={[styles.itemRow, compact && styles.itemRowCompact, index > 0 && styles.divider]}>
              <View style={styles.itemCopy}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemQuantity}>{item.quantity}</Text>
                <Text style={styles.itemQuantity}>
                  {per100g === null ? t('per100gUnknown') : `≈ ${formatNumber(displayEnergy(per100g, props.units))} ${energyUnit(props.units)} ${t('per100g')}`}
                </Text>
              </View>
              <View style={[styles.itemNutrition, compact && styles.itemNutritionCompact]}>
                <Text style={styles.itemCalories}>{formatNumber(displayEnergy(item.calories, props.units))} {energyUnit(props.units)}</Text>
                <Text style={styles.itemMacros}>
                  {t('proteinShort')} {formatMacro(item.protein, props.units)} · {t('carbsShort')} {formatMacro(item.carbs, props.units)} · {t('fatShort')} {formatMacro(item.fat, props.units)}
                </Text>
              </View>
            </View>
          ); })}
        </View>
      </View>

      <Modal animationType="fade" onRequestClose={() => setOpenPhoto(undefined)} transparent visible={Boolean(openPhoto)}>
        <SafeAreaView style={styles.photoModal}>
          <IconButton icon="close" inverted label={t('close')} onPress={() => setOpenPhoto(undefined)} />
          {openPhoto && (
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityHint={t('photoActions')}
              delayLongPress={350}
              onLongPress={() => showPhotoActions(openPhoto)}
              style={styles.fullPhoto}
            >
              <Image source={{ uri: openPhoto }} resizeMode="contain" style={styles.fullPhotoImage} />
            </Pressable>
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

function MealEditor(props: {
  draft: MealAnalysis;
  time: string;
  onChange: (analysis: MealAnalysis) => void;
  onTimeChange: (time: string) => void;
}) {
  const [expandedItem, setExpandedItem] = useState<number | undefined>(0);
  const { fontScale, width } = useWindowDimensions();
  const compact = shouldStackFormFields(width, fontScale);
  const updateItem = (index: number, field: keyof MealItem, value: string) => {
    const items = props.draft.items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      if (nutritionFields.includes(field as NutritionField)) {
        return { ...item, [field]: Math.max(0, Number(value.replace(',', '.')) || 0) };
      }
      return { ...item, [field]: value };
    });
    props.onChange({ ...props.draft, items, totals: sumItems(items) });
  };

  const removeItem = (index: number) => {
    setExpandedItem(undefined);
    const items = props.draft.items.filter((_, itemIndex) => itemIndex !== index);
    props.onChange({ ...props.draft, items, totals: sumItems(items) });
  };

  const addItem = () => {
    const items = [...props.draft.items, { name: '', quantity: '', calories: 0, protein: 0, carbs: 0, fat: 0 }];
    props.onChange({ ...props.draft, items });
    setExpandedItem(items.length - 1);
  };

  return (
    <>
      <Text style={styles.fieldLabel}>{t('mealType')}</Text>
      <View style={styles.chips}>
        {mealTypes.map((type) => (
          <Pressable
            key={type}
            accessibilityRole="button"
            accessibilityState={{ selected: props.draft.mealType === type }}
            onPress={() => props.onChange({ ...props.draft, mealType: type })}
            style={[styles.chip, props.draft.mealType === type && styles.chipSelected]}
          >
            <Text style={[styles.chipText, props.draft.mealType === type && styles.chipTextSelected]}>{t(type)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={[styles.topFields, compact && styles.topFieldsCompact]}>
        <Field label={locale === 'ru' ? 'Название' : 'Meal name'} value={props.draft.title} onChange={(title) => props.onChange({ ...props.draft, title })} />
        <Field keyboard="numbers-and-punctuation" label={t('time')} value={props.time} onChange={props.onTimeChange} fixed={!compact} />
      </View>

      <Text style={styles.itemsHeading}>{t('items')}</Text>
      {props.draft.items.map((item, index) => (
        <View key={index} style={styles.itemEditor}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: expandedItem === index }} onPress={() => setExpandedItem(expandedItem === index ? undefined : index)} style={styles.ingredientHeader}>
            <View style={{ flex: 1 }}><Text style={styles.ingredientName}>{item.name || (locale === 'ru' ? 'Новый продукт' : 'New ingredient')}</Text><Text style={styles.ingredientMeta}>{item.quantity || (locale === 'ru' ? 'Укажите порцию' : 'Add a portion')} · {formatNumber(item.calories)} {t('kcal')}</Text></View>
            <Ionicons name={expandedItem === index ? 'chevron-up' : 'chevron-down'} size={18} color={color.action} />
          </Pressable>
          {expandedItem === index && <>
          <View style={[styles.topFields, compact && styles.topFieldsCompact]}>
            <Field label={t('itemName')} value={item.name} onChange={(value) => updateItem(index, 'name', value)} />
            <Field label={t('quantity')} value={item.quantity} onChange={(value) => updateItem(index, 'quantity', value)} />
          </View>
          <View style={[styles.nutritionFields, compact && styles.nutritionFieldsCompact]}>
            {nutritionFields.map((field) => (
              <Field
                key={field}
                keyboard="decimal-pad"
                label={field === 'calories' ? t('caloriesField') : `${t(field)} (${t('grams')})`}
                nutrition
                stacked={compact}
                value={String(item[field])}
                onChange={(value) => updateItem(index, field, value)}
              />
            ))}
          </View>
          {props.draft.items.length > 1 && <Pressable accessibilityRole="button" accessibilityLabel={locale === 'ru' ? 'Удалить продукт' : 'Remove ingredient'} onPress={() => removeItem(index)} style={styles.removeIngredient}><Ionicons name="trash-outline" size={17} color={color.error} /><Text style={{ color: color.error, fontSize: 13 }}>{locale === 'ru' ? 'Удалить продукт' : 'Remove ingredient'}</Text></Pressable>}
          </>}
        </View>
      ))}
      <Pressable accessibilityRole="button" onPress={addItem} style={styles.addItem}>
        <Ionicons name="add" size={19} color={color.action} />
        <Text style={styles.addItemText}>{t('addItem')}</Text>
      </Pressable>
      <Text style={styles.editorTotal}>{t('total')}: {formatNumber(sumItems(props.draft.items).calories)} {t('kcal')}</Text>
    </>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  fixed?: boolean;
  nutrition?: boolean;
  stacked?: boolean;
  keyboard?: 'default' | 'decimal-pad' | 'numbers-and-punctuation';
}) {
  return (
    <View style={[styles.field, props.fixed && styles.fieldFixed, props.nutrition && styles.fieldNutrition, props.stacked && styles.fieldStacked]}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        keyboardType={props.keyboard ?? 'default'}
        multiline={!props.nutrition && props.keyboard !== 'numbers-and-punctuation'}
        onChangeText={props.onChange}
        placeholderTextColor={color.muted}
        style={[styles.fieldInput, !props.nutrition && props.keyboard !== 'numbers-and-punctuation' && styles.fieldInputMultiline]}
        textAlignVertical="center"
        value={props.value}
      />
    </View>
  );
}

function sumItems(items: MealItem[]): NutritionTotals {
  return items.reduce((total, item) => ({
    calories: total.calories + item.calories,
    protein: total.protein + item.protein,
    carbs: total.carbs + item.carbs,
    fat: total.fat + item.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function editableTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function energyUnit(units: NutritionUnits): string {
  return units.energy === 'kj' ? t('kilojoules') : t('kcal');
}

function formatMacro(grams: number, units: NutritionUnits): string {
  return `${formatNumber(displayWeight(grams, units), units.weight === 'oz' ? 1 : 0)} ${units.weight === 'oz' ? t('ounces') : t('grams')}`;
}

const styles = StyleSheet.create({
  saveDock: { paddingHorizontal: 20, paddingTop: 10, backgroundColor: color.canvas, borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth },
  deleteAction: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  ingredientHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingBottom: 10 },
  ingredientName: { color: color.ink, fontFamily: type.ticket, fontSize: 15, lineHeight: 21 },
  ingredientMeta: { color: color.muted, fontSize: 12, marginTop: 4 },
  removeIngredient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7, minHeight: 48, marginTop: 6 },
  safeArea: { backgroundColor: color.canvas, flex: 1 },
  scroll: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', height: 64, justifyContent: 'space-between', paddingHorizontal: space.md },
  headerSide: { alignItems: 'flex-start', width: 88 },
  headerSideEnd: { alignItems: 'flex-end' },
  headerTitle: { color: color.ink, flex: 1, fontFamily: type.ticketBold, fontSize: 20, textAlign: 'center' },
  headerActionButton: { alignItems: 'flex-end', justifyContent: 'center', minHeight: 48, maxWidth: 88 },
  headerAction: { color: color.action, fontFamily: type.ticketBold, fontSize: 15, textAlign: 'right' },
  content: { paddingBottom: 48, paddingHorizontal: space.md, paddingTop: space.sm },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 28, gap: 16 },
  pendingPhoto: { width: 160, height: 160, borderRadius: 24, marginBottom: 12 },
  pendingHelp: { color: color.muted, fontSize: 15, lineHeight: 23, textAlign: 'center', marginBottom: 12 },
  loadingText: { color: color.muted, fontSize: 14, marginTop: space.sm },
  photoGallery: { gap: space.sm, paddingBottom: space.md },
  mealPhoto: { backgroundColor: color.camera, borderRadius: radius.image, height: 138 },
  photoIndex: { backgroundColor: color.cameraChrome, borderRadius: radius.round, bottom: space.sm, paddingHorizontal: 9, paddingVertical: 5, position: 'absolute', right: space.sm },
  photoIndexText: { color: color.cameraText, fontFamily: type.ticketBold, fontSize: 12 },
  noteBlock: { backgroundColor: color.actionSoft, borderRadius: 12, marginBottom: space.md, paddingHorizontal: 12, paddingVertical: 2 },
  noteLabel: { color: color.action, fontFamily: type.ticketBold, fontSize: 13, letterSpacing: 0.5 },
  noteText: { color: color.ink, fontSize: 15, lineHeight: 21, marginTop: 3 },
  photoModal: { backgroundColor: color.camera, flex: 1, padding: space.md },
  fullPhoto: { flex: 1, width: '100%' },
  fullPhotoImage: { height: '100%', width: '100%' },
  detailTicket: { paddingHorizontal: 4 },
  mealType: { color: color.muted, fontFamily: type.ticket, fontSize: 14 },
  title: { color: color.ink, fontFamily: type.ticketBold, fontSize: 25, lineHeight: 31, marginTop: 4 },
  totalRow: { marginTop: 14, marginBottom: 20, paddingBottom: 18, borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth },
  totalCalories: { color: color.ink, fontFamily: type.ticketBold, fontSize: 23 },
  totalMacros: { color: color.muted, fontSize: 13, marginTop: 4 },
  items: { marginTop: 12 },
  itemRow: { alignItems: 'flex-start', flexDirection: 'row', gap: space.md, paddingVertical: 13 },
  itemRowCompact: { flexDirection: 'column', gap: space.sm },
  divider: { borderTopColor: color.line, borderTopWidth: 1, borderStyle: 'dashed' },
  itemCopy: { flex: 1 },
  itemName: { color: color.ink, fontSize: 16, fontWeight: '600' },
  itemQuantity: { color: color.muted, fontSize: 13, marginTop: 3 },
  itemNutrition: { alignItems: 'flex-end', flexShrink: 1, maxWidth: '52%' },
  itemNutritionCompact: { alignItems: 'flex-start', maxWidth: '100%' },
  itemCalories: { color: color.ink, fontSize: 14, fontWeight: '600' },
  itemMacros: { color: color.muted, flexShrink: 1, fontSize: 11, marginTop: 4, textAlign: 'right' },
  assistantAction: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: space.sm, marginTop: space.lg, minHeight: 52, paddingHorizontal: space.xs },
  assistantActionText: { color: color.ink, flex: 1, fontFamily: type.ticketBold, fontSize: 17 },
  editWithAssistant: { alignItems: 'center', backgroundColor: color.actionSoft, borderColor: color.line, borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: space.sm, marginBottom: 18, minHeight: 60, padding: space.sm },
  editWithAssistantIcon: { alignItems: 'center', backgroundColor: color.surfacePressed, borderRadius: radius.control, height: 42, justifyContent: 'center', width: 42 },
  editWithAssistantCopy: { flex: 1, minWidth: 0 },
  editWithAssistantTitle: { color: color.ink, fontFamily: type.ticketBold, fontSize: 15 },
  editWithAssistantHelp: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  clarification: { backgroundColor: color.attentionSoft, borderColor: color.line, borderRadius: radius.surface, borderStyle: 'solid', borderWidth: 1, marginBottom: space.md, padding: space.md },
  clarificationLabel: { color: color.pending, fontFamily: type.ticketBold, fontSize: 14, letterSpacing: 0.4 },
  answerInChat: { alignItems: 'center', borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: space.sm, marginTop: space.md, minHeight: 42, paddingTop: space.sm },
  answerInChatText: { color: color.action, flex: 1, fontFamily: type.ticketBold, fontSize: 14 },
  clarificationActivity: { color: color.muted, fontSize: 12, marginTop: space.sm },
  correctionToggle: { borderColor: color.line, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', marginTop: space.lg, minHeight: 50, paddingHorizontal: space.md },
  correctionToggleText: { color: color.action, fontFamily: type.ticketBold, fontSize: 16, textAlign: 'center' },
  correction: { backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.surface, borderStyle: 'solid', borderWidth: 1, marginTop: space.sm, padding: space.md },
  correctionLabel: { gap: 3 },
  correctionTitle: { color: color.action, fontFamily: type.ticketBold, fontSize: 16, letterSpacing: 0.4 },
  correctionHelp: { color: color.muted, fontSize: 12, lineHeight: 17 },
  correctionRow: { alignItems: 'center', flexDirection: 'row', gap: space.sm, marginTop: space.md },
  correctionInput: { backgroundColor: color.canvas, borderRadius: radius.control, color: color.ink, flex: 1, fontSize: 15, height: 50, paddingHorizontal: 14 },
  correctionSend: { alignItems: 'center', backgroundColor: color.action, borderRadius: radius.control, height: 48, justifyContent: 'center', width: 48 },
  disabled: { opacity: 0.38 },
  pressed: { backgroundColor: color.actionPressed, transform: [{ scale: 0.95 }] },
  error: { color: color.error, fontSize: 13, marginTop: space.md },
  fieldLabel: { color: color.muted, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg },
  chip: { backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: 48, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: color.action },
  chipText: { color: color.ink, fontFamily: type.ticket, fontSize: 13 },
  chipTextSelected: { color: color.surface },
  topFields: { flexDirection: 'row', gap: space.sm },
  topFieldsCompact: { flexDirection: 'column' },
  field: { flex: 1, minWidth: 0 },
  fieldFixed: { flex: 0, width: 112 },
  fieldNutrition: { flexBasis: '47%', minWidth: 100 },
  fieldStacked: { flexBasis: '47%' },
  fieldInput: { backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.control, borderWidth: 1, color: color.ink, fontSize: 15, minHeight: 50, minWidth: 0, paddingHorizontal: 13, width: '100%' },
  fieldInputMultiline: { minHeight: 56, paddingVertical: 10 },
  itemsHeading: { color: color.ink, fontFamily: type.ticketBold, fontSize: 22, marginBottom: space.md, marginTop: space.xl },
  itemEditor: { backgroundColor: color.surface, borderRadius: radius.surface, marginBottom: 10, padding: 14 },
  itemEditorHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.sm },
  itemIndex: { color: color.muted, fontSize: 12, fontWeight: '700' },
  nutritionFields: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  nutritionFieldsCompact: { flexWrap: 'wrap' },
  addItem: { alignItems: 'center', flexDirection: 'row', gap: 7, minHeight: 48 },
  addItemText: { color: color.action, fontSize: 14, fontWeight: '700' },
  editorTotal: { color: color.ink, fontSize: 15, fontWeight: '700', marginTop: space.lg },
  editActions: { gap: space.lg, marginTop: space.xl },
  delete: { color: color.error, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
