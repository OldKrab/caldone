import { MealProgress } from '../../components/MealProgress';
import { buildActivityFeed, type ActivityTool } from './activityFeed';
import { QuestionAnswers } from '../../components/QuestionAnswers';
import { mealQuestionChoices } from '../../domain/mealQuestions';
import type { QuestionChoices } from '../../domain/questionChoices';
import { AssistantError } from './AssistantError';
import { Ionicons } from '@expo/vector-icons';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { actionDetails } from './actionDetails';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../../components/controls';
import { AnchoredMenu, type MenuAnchor } from '../../components/AnchoredMenu';
import { useAppDialog } from '../../components/AppDialog';
import { ScreenReveal } from '../../components/ScreenReveal';
import { appendDiagnosticEvent, getPreference, savePreference } from '../../data/mealRepository';
import { color, radius, space, type } from '../../design/tokens';
import type { ChatAction, ChatAttachment, ChatMealQuestionMessage, ChatThread } from '../../domain/chat';
import { mealQuestions, type Meal } from '../../domain/meal';
import { locale, formatTime, t } from '../../i18n';
import { openChatSession, type ChatSession, type ChatSessionSnapshot } from '../../services/chatSession';
import type { ProviderToolActivity } from '../../ai/providerActivity';
import { userFacingToolActivity } from '../../ai/toolActivity';
import { AssistantMarkdown } from './AssistantMarkdown';
import { composerBottomSpace, keyboardAvoidingBehavior, keyboardAvoidingOffset, keyboardOccupiesWindow } from './composerPlacement';

export function AssistantScreen(props: {
  answeringMealIds?: ReadonlySet<string>;
  thread: ChatThread;
  selectedMeal?: Meal;
  meals: Meal[];
  bottomInset: number;
  onDataChanged: () => Promise<void>;
  onHistory: () => void;
  onNewChat: () => void;
  onModelSettings: () => void;
  onClearMealContext: () => void;
  onUndo: (actionId: string) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<ChatSessionSnapshot>({ messages: [], actions: [], providerActivities: [], busy: false });
  const [session, setSession] = useState<ChatSession>();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [undoing, setUndoing] = useState<string>();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [instructionsSaving, setInstructionsSaving] = useState(false);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor>();
  const dialog = useAppDialog();
  const safeAreaInsets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const restingWindowHeight = useRef(windowHeight);
  restingWindowHeight.current = Math.max(restingWindowHeight.current, windowHeight);
  const effectiveKeyboardVisible = Platform.OS === 'android'
    ? keyboardOccupiesWindow(keyboardVisible, windowHeight, restingWindowHeight.current)
    : keyboardVisible;
  const menuButton = useRef<View>(null);
  const screenRoot = useRef<View>(null);
  const composerRoot = useRef<View>(null);
  const diagnosticTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const scroll = useRef<ScrollView>(null);
  const unsentAttachments = useRef<ChatAttachment[]>([]);

  useEffect(() => () => {
    for (const timer of diagnosticTimers.current) clearTimeout(timer);
    for (const attachment of unsentAttachments.current) {
      try { new File(attachment.uri).delete(); } catch { /* Best-effort cleanup. */ }
    }
  }, []);

  const recordLayoutDiagnostic = (
    phase: 'input_focus' | 'keyboard_show' | 'keyboard_hide',
    eventVisible: boolean,
    eventKeyboard?: { height: number; screenY: number },
  ) => {
    const timer = setTimeout(() => {
      diagnosticTimers.current.delete(timer);
      void Promise.all([measureInWindow(screenRoot.current), measureInWindow(composerRoot.current)]).then(([screen, composer]) => {
        const window = Dimensions.get('window');
        const keyboardMetrics = Keyboard.metrics();
        const keyboard = eventKeyboard ?? (keyboardMetrics ? {
          height: keyboardMetrics.height,
          screenY: keyboardMetrics.screenY,
        } : undefined);
        return appendDiagnosticEvent({
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
          createdAt: Date.now(),
          operation: 'layout',
          traceVersion: 'assistant-layout-v1',
          phase,
          platform: Platform.OS,
          platformVersion: Platform.Version,
          window,
          screen,
          composer,
          keyboard,
          keyboardEventVisible: eventVisible,
          effectiveKeyboardVisible: keyboardOccupiesWindow(eventVisible, window.height, restingWindowHeight.current),
          restingWindowHeight: restingWindowHeight.current,
          navigationInset: props.bottomInset,
          safeAreaBottom: safeAreaInsets.bottom,
        });
      }).catch(() => undefined);
    }, 220);
    diagnosticTimers.current.add(timer);
  };

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardVisible(true);
      recordLayoutDiagnostic('keyboard_show', true, {
        height: event.endCoordinates.height,
        screenY: event.endCoordinates.screenY,
      });
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      recordLayoutDiagnostic('keyboard_hide', false);
    });
    return () => { shown.remove(); hidden.remove(); };
  }, [props.bottomInset, safeAreaInsets.bottom]);

  useEffect(() => {
    let active = true;
    let opened: ChatSession | undefined;
    setSnapshot({ messages: [], actions: [], providerActivities: [], busy: false });
    void openChatSession({
      thread: props.thread,
      selectedMealId: props.selectedMeal?.id,
      selectedMealQuestions: mealQuestions(props.selectedMeal?.analysis?.clarification),
      onChanged: (next) => active && setSnapshot({ ...next }),
      onDataChanged: props.onDataChanged,
    }).then((next) => {
      if (!active) return void next.close();
      opened = next;
      setSession(next);
    }).catch(() => active && setSnapshot((current) => ({ ...current, error: t('assistantUnavailable') })));
    return () => {
      active = false;
      void opened?.close();
    };
  }, [props.thread.id, props.selectedMeal?.id, sessionRevision]);

  const feed = useMemo(() => buildActivityFeed({
    ...snapshot,
    answeringMealIds: props.answeringMealIds,
    pendingMealQuestions: Object.fromEntries(props.meals.map(meal => [meal.id, mealQuestions(meal.analysis?.clarification)])),
  }), [snapshot, props.meals, props.answeringMealIds]);
  const mealChoicesById = useMemo(() => new Map(props.meals.map(meal => [meal.id, mealQuestionChoices(meal.analysis?.clarification)])), [props.meals]);
  const toolResults = useMemo(() => {
    const results = new Map<string, Extract<AgentMessage, { role: 'toolResult' }>>();
    for (const message of snapshot.messages) {
      if (message.role === 'toolResult') results.set(message.toolCallId, message);
    }
    return results;
  }, [snapshot.messages]);
  // Pending calls belong only to the current user turn, never to older interrupted turns.
  const currentTurnMessages = new Set(snapshot.messages.slice(snapshot.messages.findLastIndex((message) => message.role === 'chatUser' || message.role === 'user') + 1));
  const streamingHasText = snapshot.streamingMessage?.role === 'assistant' && snapshot.streamingMessage.content.some((block) => block.type === 'text' && block.text.length > 0);
  const streamingHasActivity = snapshot.streamingMessage?.role === 'assistant' && snapshot.streamingMessage.content.some((block) => block.type === 'toolCall');
  const hasPendingTool = snapshot.messages.some((message) => currentTurnMessages.has(message) && message.role === 'assistant' && message.content.some((block) => block.type === 'toolCall' && !toolResults.has(block.id)));
  const showWorking = snapshot.busy && !streamingHasText && !streamingHasActivity && !hasPendingTool && snapshot.providerActivities.length === 0;
  useEffect(() => {
    const timeout = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 40);
    return () => clearTimeout(timeout);
  }, [effectiveKeyboardVisible, feed.length, snapshot.streamingMessage, windowHeight]);

  const send = async (suggestion?: string) => {
    const text = suggestion ?? draft;
    if (!session || snapshot.busy || snapshot.mealActivity || (!text.trim() && attachments.length === 0)) return;
    const sentAttachments = attachments;
    setDraft('');
    setAttachments([]);
    unsentAttachments.current = [];
    try {
      await session.send(text, sentAttachments);
    } catch {
      setDraft(text);
      setAttachments(sentAttachments);
      unsentAttachments.current = sentAttachments;
    }
  };

  // Button answers are separate messages; preserve any unsent composer text and photos.
  const sendAnswer = async (answer: string) => {
    if (!session) throw new Error('Session unavailable');
    await session.send(answer, []);
  };

  const addImages = async (source: 'camera' | 'library') => {
    if (attachmentBusy) return;
    setAttachmentBusy(true);
    try {
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.72 })
        : await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true, mediaTypes: ['images'], orderedSelection: true, quality: 0.72, selectionLimit: 0 });
      if (!result.canceled) {
        const stored = await Promise.all(result.assets.map(storeAttachment));
        setAttachments((current) => {
          const next = [...current, ...stored];
          unsentAttachments.current = next;
          return next;
        });
      }
    } catch {
      dialog.show({ title: t('assistantPhotoError'), actions: [{ label: t('close'), role: 'cancel' }] });
    } finally {
      setAttachmentBusy(false);
    }
  };

  const chooseAttachment = () => dialog.show({ title: t('attachPhoto'), actions: [
    { label: t('takePhoto'), onPress: () => void addImages('camera') },
    { label: t('chooseExistingPhoto'), onPress: () => void addImages('library') },
    { label: t('cancel'), role: 'cancel' },
  ] });

  const removeAttachment = (attachment: ChatAttachment) => {
    setAttachments((current) => {
      const next = current.filter((item) => item.id !== attachment.id);
      unsentAttachments.current = next;
      return next;
    });
    try { new File(attachment.uri).delete(); } catch { /* A picker cache may already be gone. */ }
  };

  const undo = async (actionId: string) => {
    setUndoing(actionId);
    try {
      await props.onUndo(actionId);
      await props.onDataChanged();
    } catch {
      dialog.show({ title: t('undoUnavailable'), actions: [{ label: t('close'), role: 'cancel' }] });
    } finally {
      setUndoing(undefined);
    }
  };

  const openInstructions = async () => {
    setInstructions((await getPreference('assistant_custom_instructions')) ?? '');
    setInstructionsOpen(true);
  };

  const saveInstructions = async () => {
    setInstructionsSaving(true);
    try {
      await savePreference('assistant_custom_instructions', instructions.trim());
      setInstructionsOpen(false);
      setSessionRevision((value) => value + 1);
    } finally {
      setInstructionsSaving(false);
    }
  };

  const showHeaderMenu = () => menuButton.current?.measureInWindow((x, y, width, height) => {
    setMenuAnchor({ x, y, width, height });
  });

  return (
    <SafeAreaView ref={screenRoot} edges={['top', 'left', 'right']} style={styles.safeArea}>
      <ScreenReveal>
        <KeyboardAvoidingView
          behavior={keyboardAvoidingBehavior(Platform.OS)}
          keyboardVerticalOffset={keyboardAvoidingOffset(Platform.OS, safeAreaInsets.top)}
          style={styles.screen}
        >
          <View style={styles.header}>
            <IconButton icon="time-outline" label={t('chatHistory')} onPress={props.onHistory} />
            <Text selectable adjustsFontSizeToFit minimumFontScale={0.86} numberOfLines={1} style={styles.headerTitle}>{t('assistant')}</Text>
            <IconButton ref={menuButton} icon="ellipsis-horizontal" label={t('assistantOptions')} onPress={showHeaderMenu} />
          </View>
          {props.selectedMeal && (
            <View style={styles.mealContext}>
              {props.selectedMeal.photos[0] && <Image source={{ uri: props.selectedMeal.photos[0].uri }} style={styles.mealContextPhoto} />}
              <View style={styles.mealContextCopy}>
                <Text selectable style={styles.mealContextLabel}>{t('mealContext')}</Text>
                <Text selectable numberOfLines={1} style={styles.mealContextTitle}>{props.selectedMeal.analysis?.title ?? t('meal')}</Text>
              </View>
              <IconButton icon="close" label={t('clearMealContext')} onPress={props.onClearMealContext} />
            </View>
          )}
          <ScrollView
            ref={scroll}
            contentContainerStyle={styles.feed}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.feedScroll}
          >
            {feed.length === 0 && !snapshot.busy ? (
              <EmptyAssistant selectedMeal={Boolean(props.selectedMeal)} onSuggestion={(value) => void send(value)} />
            ) : (
              feed.map((item) => item.kind === 'message'
                ? <MessageRow key={item.key} message={item.message}
                    activeQuestions={item.activeQuestions}
                    choices={item.message.role === 'mealQuestion' ? mealChoicesById.get(item.message.mealId) : undefined}
                    disabled={!session || snapshot.busy || Boolean(snapshot.mealActivity)}
                    onAnswer={sendAnswer} />
                : item.kind === 'question' ? <QuestionAnswers key={item.key} questions={item.questions}
                    disabled={!item.active || !session || Boolean(snapshot.mealActivity)}
                    onSubmit={sendAnswer} />
                : item.kind === 'activity' ? <ActivityGroup key={item.key} tools={item.tools} />
                : <ActionRow key={item.key} action={item.action} busy={undoing === item.action.id} onUndo={() => void undo(item.action.id)} />)
            )}
            {snapshot.providerActivities.map((activity) => <ProviderActivityRow key={activity.id} activity={activity} />)}
            {snapshot.mealActivity && <MealProgress mealId={props.selectedMeal?.id ?? props.thread.mealId} stage={snapshot.mealActivity} />}
            {snapshot.recovering && <WorkingRow label={locale === 'ru' ? 'Восстанавливаю соединение…' : 'Reconnecting…'} />}
            {showWorking && !snapshot.recovering && !snapshot.mealActivity && (
              <MealProgress label={t('assistantWorking')} />
            )}
            {props.selectedMeal?.error && !snapshot.mealActivity && !snapshot.busy && !snapshot.error &&
              <AssistantError error={props.selectedMeal.error} />}
            {snapshot.error && !snapshot.busy && <AssistantError error={snapshot.error}
              retryDisabled={Boolean(snapshot.mealActivity)}
              onRetry={() => void session?.retry().catch(() => undefined)} />}
          </ScrollView>

          <View ref={composerRoot} style={[styles.composerDock, { paddingBottom: space.sm + composerBottomSpace(effectiveKeyboardVisible, props.bottomInset) }]}>
            {attachments.length > 0 && (
              <ScrollView horizontal contentContainerStyle={styles.attachments} showsHorizontalScrollIndicator={false}>
                {attachments.map((attachment) => (
                  <Pressable key={attachment.id} accessibilityLabel={t('removePhoto')} onPress={() => removeAttachment(attachment)}>
                    <Image source={{ uri: attachment.uri }} style={styles.attachment} />
                    <View style={styles.removeAttachment}><Ionicons name="close" size={12} color={color.surface} /></View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={styles.composer}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('attachPhoto')} disabled={snapshot.busy || Boolean(snapshot.mealActivity) || attachmentBusy} onPress={chooseAttachment} style={({ pressed }) => [styles.attachButton, pressed && styles.pressed]}>
                {attachmentBusy ? <ActivityIndicator color={color.action} size="small" /> : <Ionicons name="add" size={24} color={color.action} />}
              </Pressable>
              <TextInput
                accessibilityLabel={t('messageAssistant')}
                editable={!snapshot.busy && !snapshot.mealActivity}
                multiline
                onChangeText={setDraft}
                onFocus={() => recordLayoutDiagnostic('input_focus', Keyboard.isVisible())}
                onSubmitEditing={() => void send()}
                placeholder={t('messageAssistant')}
                placeholderTextColor={color.muted}
                style={styles.input}
                value={draft}
              />
              <Pressable accessibilityRole="button" accessibilityLabel={snapshot.busy ? t('stop') : t('send')} disabled={Boolean(snapshot.mealActivity) && !snapshot.busy || !snapshot.busy && !draft.trim() && attachments.length === 0} onPress={() => snapshot.busy ? session?.abort() : void send()} style={({ pressed }) => [styles.sendButton, !snapshot.busy && !draft.trim() && attachments.length === 0 && styles.disabled, pressed && styles.sendPressed]}>
                <Ionicons name={snapshot.busy ? 'stop' : 'arrow-up'} size={20} color={color.surface} />
              </Pressable>
            </View>
          </View>
          <AssistantInstructionsModal
            busy={instructionsSaving}
            onCancel={() => setInstructionsOpen(false)}
            onChange={setInstructions}
            onSave={() => void saveInstructions()}
            value={instructions}
            visible={instructionsOpen}
          />
          <AnchoredMenu
            anchor={menuAnchor}
            items={[
              { label: t('assistantInstructions'), icon: 'options-outline', onPress: () => void openInstructions() },
              { label: t('modelSettings'), icon: 'hardware-chip-outline', onPress: props.onModelSettings },
              { label: t('newChat'), icon: 'create-outline', onPress: props.onNewChat },
            ]}
            onClose={() => setMenuAnchor(undefined)}
          />
        </KeyboardAvoidingView>
      </ScreenReveal>
    </SafeAreaView>
  );
}

export function ChatHistoryScreen(props: {
  threads: ChatThread[];
  onBack: () => void;
  onNewChat: () => void;
  onOpen: (thread: ChatThread) => void;
  onDelete: (thread: ChatThread) => void;
}) {
  const dialog = useAppDialog();
  const confirmDelete = (thread: ChatThread) => dialog.show({ title: t('deleteConversationTitle'), actions: [
    { label: t('delete'), role: 'destructive', onPress: () => props.onDelete(thread) },
    { label: t('cancel'), role: 'cancel' },
  ] });
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenReveal>
        <View style={styles.historyHeader}>
          <IconButton icon="arrow-back" label={t('back')} onPress={props.onBack} />
          <Text selectable adjustsFontSizeToFit minimumFontScale={0.86} numberOfLines={1} style={styles.headerTitle}>{t('chatHistory')}</Text>
          <IconButton icon="add" label={t('newChat')} onPress={props.onNewChat} />
        </View>
        <ScrollView contentContainerStyle={styles.historyList}>
          {props.threads.map((thread) => (
            <View key={thread.id} style={styles.threadRow}>
              <Pressable accessibilityRole="button" onPress={() => props.onOpen(thread)} style={({ pressed }) => [styles.threadOpen, pressed && styles.threadPressed]}>
                <View style={styles.threadCopy}>
                  <Text numberOfLines={1} style={styles.threadTitle}>{thread.title || t('newConversation')}</Text>
                  <Text style={styles.threadTime}>{new Date(thread.updatedAt).toLocaleString()}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={color.muted} />
              </Pressable>
              <IconButton icon="ellipsis-horizontal" label={t('deleteConversation')} onPress={() => confirmDelete(thread)} />
            </View>
          ))}
        </ScrollView>
      </ScreenReveal>
    </SafeAreaView>
  );
}

function AssistantInstructionsModal(props: {
  visible: boolean;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={props.onCancel} transparent visible={props.visible}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' || Platform.OS === 'android' ? 'padding' : undefined} style={styles.instructionsBackdrop}>
        <Pressable accessibilityLabel={t('close')} accessibilityRole="button" onPress={props.onCancel} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.instructionsSafeArea}>
          <View accessibilityViewIsModal style={styles.instructionsSheet}>
            <Text selectable accessibilityRole="header" style={styles.instructionsTitle}>{t('assistantInstructions')}</Text>
            <Text selectable style={styles.instructionsHelp}>{t('assistantInstructionsHelp')}</Text>
            <TextInput
              autoFocus
              maxLength={4000}
              multiline
              onChangeText={props.onChange}
              placeholder={t('assistantInstructionsPlaceholder')}
              placeholderTextColor={color.muted}
              style={styles.instructionsInput}
              textAlignVertical="top"
              value={props.value}
            />
            <View style={styles.instructionsActions}>
              <Pressable accessibilityRole="button" disabled={props.busy} onPress={props.onCancel} style={({ pressed }) => [styles.instructionsSecondary, pressed && styles.threadPressed]}>
                <Text style={styles.instructionsSecondaryText}>{t('cancel')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={props.busy} onPress={props.onSave} style={({ pressed }) => [styles.instructionsPrimary, pressed && styles.sendPressed]}>
                {props.busy ? <ActivityIndicator color={color.surface} size="small" /> : <Text style={styles.instructionsPrimaryText}>{t('save')}</Text>}
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function EmptyAssistant(props: { selectedMeal: boolean; onSuggestion: (value: string) => void }) {
  const suggestions = props.selectedMeal
    ? [t('suggestExplainMeal'), t('suggestCorrectMeal')]
    : [t('suggestYesterday'), t('suggestGoals')];
  return (
    <View style={styles.empty}>
      <View style={styles.emptyMark}><Ionicons name="chatbox-ellipses-outline" size={27} color={color.action} /></View>
      <Text selectable style={styles.emptyTitle}>{props.selectedMeal ? t('askAboutMeal') : t('assistantReady')}</Text>
      <View style={styles.suggestions}>
        {suggestions.map((suggestion) => (
          <Pressable key={suggestion} accessibilityRole="button" onPress={() => props.onSuggestion(suggestion)} style={({ pressed }) => [styles.suggestion, pressed && styles.threadPressed]}>
            <Text style={styles.suggestionText}>{suggestion}</Text>
            <Ionicons name="arrow-forward" size={16} color={color.action} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MessageRow(props: {
  message: AgentMessage;
  activeQuestions?: string[];
  choices?: QuestionChoices[];
  disabled?: boolean;
  onAnswer: (answer: string) => Promise<void>;
}) {
  if (props.message.role === 'toolResult' || props.message.role === 'user') return null;
  if (props.message.role === 'mealQuestion') {
    const questionMessage = props.message as ChatMealQuestionMessage;
    const activeQuestions = questionMessage.questions.filter(question => props.activeQuestions?.includes(question));
    return (
      <View style={styles.questionMessage}>
        <Text selectable style={styles.questionMessageLabel}>{t('clarificationTitle')}</Text>
        {questionMessage.questions.filter(question => !activeQuestions.includes(question)).map((question, index) => (
          <Text selectable key={`${question}-${index}`} style={styles.questionMessageText}>{question}</Text>
        ))}
        {activeQuestions.length > 0 && <QuestionAnswers key={JSON.stringify([activeQuestions, props.choices])}
          questions={activeQuestions.map(question => ({ question, options: props.choices?.find(choice => choice.question === question)?.options ?? [] }))}
          disabled={props.disabled} onSubmit={props.onAnswer} />}
      </View>
    );
  }
  if (props.message.role === 'chatUser') {
    return (
      <View style={styles.userWrap}>
        {props.message.attachments.length > 0 && (
          <ScrollView horizontal contentContainerStyle={styles.messagePhotos} showsHorizontalScrollIndicator={false}>
            {props.message.attachments.map((photo) => <Image key={photo.id} source={{ uri: photo.uri }} style={styles.messagePhoto} />)}
          </ScrollView>
        )}
        <View style={styles.userMessage}><Text selectable style={styles.userText}>{props.message.text}</Text></View>
      </View>
    );
  }
  if (props.message.role !== 'assistant') return null;
  return <View style={styles.assistantMessage}>{props.message.content.map((block, index) => block.type === 'text' && block.text ? <AssistantMarkdown key={index}>{block.text}</AssistantMarkdown> : null)}</View>;
}

function ActivityGroup({ tools }: { tools: ActivityTool[] }) {
  const [expanded, setExpanded] = useState(false);
  const active = tools.some(tool => tool.status === 'running' || tool.status === 'preparing');
  const failed = tools.some(tool => tool.status === 'failed');
  const cancelled = tools.some(tool => tool.status === 'cancelled');
  if (tools.length === 1) return <ToolActivityRow tool={tools[0]} />;
  const summary = active ? t('assistantWorking') : failed
    ? (locale === 'ru' ? 'Есть невыполненные действия' : 'Some actions failed') : cancelled
    ? (locale === 'ru' ? 'Действия прерваны' : 'Actions interrupted')
    : (locale === 'ru' ? `Выполнено действий: ${tools.length}` : `${tools.length} actions completed`);
  // While collapsed, active and failed rows stay visible; successful details
  // collapse automatically at completion without hiding the separate undo receipts.
  return <View style={styles.stepsGroup}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.stepsToggle}>
      <Ionicons name={failed ? 'alert-circle-outline' : active ? 'ellipsis-horizontal' : cancelled ? 'remove-circle-outline' : 'checkmark-circle-outline'} size={17} color={failed ? color.error : color.action} />
      <Text style={styles.stepsLabel}>{summary}</Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={color.muted} />
    </Pressable>
    {tools.filter(tool => expanded || tool.status !== 'completed').map(tool => <ToolActivityRow key={tool.call.id} tool={tool} />)}
  </View>;
}

function ToolActivityRow({ tool }: { tool: ActivityTool }) {
  const active = tool.status === 'running' || tool.status === 'preparing';
  const failed = tool.status === 'failed';
  const label = tool.status === 'preparing' ? (locale === 'ru' ? 'Подготавливаю действие…' : 'Preparing action…') : toolActivityLabel(tool.call.name, tool.call.arguments);
  const status = tool.status === 'cancelled' ? (locale === 'ru' ? 'Прервано' : 'Cancelled') : failed ? (locale === 'ru' ? 'Не выполнено' : 'Failed') : '';
  if (active) return <MealProgress label={label} />;
  return <View>
    <View accessibilityLabel={`${label}${status ? `. ${status}` : ''}`} style={styles.toolActivity}>
      <Ionicons name={failed ? 'alert-circle-outline' : tool.status === 'cancelled' ? 'remove-circle-outline' : 'checkmark'} size={16} color={failed ? color.error : color.muted} />
      <Text selectable style={[styles.toolActivityText, failed && styles.toolActivityError]}>{label}{status ? ` · ${status}` : ''}</Text>
    </View>
    {failed && tool.error && <AssistantError error={tool.error} />}
  </View>;
}

function ProviderActivityRow(props: { activity: ProviderToolActivity }) {
  const failed = props.activity.status === 'error';
  if (props.activity.status === 'active') return <MealProgress label={toolActivityLabel(props.activity.name, {})} />;
  return (
    <View accessibilityLabel={toolActivityLabel(props.activity.name, {})} style={styles.toolActivity}>
      <Ionicons name={failed ? 'alert-circle-outline' : 'checkmark'} size={16} color={failed ? color.error : color.muted} />
      <Text selectable numberOfLines={2} style={[styles.toolActivityText, failed && styles.toolActivityError]}>
        {toolActivityLabel(props.activity.name, {})}
      </Text>
    </View>
  );
}

function WorkingRow(props: { label: string }) {
  return (
    <View style={styles.working}>
      <ActivityIndicator color={color.action} size="small" />
      <Text selectable style={styles.workingText}>{props.label}</Text>
    </View>
  );
}

function toolActivityLabel(name: string, args: Record<string, unknown>): string {
  const generated = userFacingToolActivity(args.statusText);
  if (generated) return generated;
  if (name === 'ask_question') return locale === 'ru' ? 'Готовлю варианты ответа' : 'Preparing answer choices';
  if (name === 'search_meals' || name === 'list_meals') return t('toolListMeals');
  if (name === 'get_meal') return t('toolGetMeal');
  if (name === 'view_meal_photos') return t('toolViewMealPhotos');
  if (name === 'summarize_nutrition') return t('toolSummarizeNutrition');
  if (name === 'get_goals') return t('toolGetGoals');
  if (name === 'get_goal_profile') return t('toolGetGoalProfile');
  if (name === 'create_meal') return t('toolCreateMeal');
  if (name === 'edit_meal' || name === 'update_meal') return t('toolUpdateMeal');
  if (name === 'reanalyze_meal') return t('toolReanalyzeMeal');
  if (name === 'delete_meal') return t('toolDeleteMeal');
  if (name === 'answer_meal_question' || name === 'answer_meal_clarification') return t('toolAnswerClarification');
  if (name === 'update_goals') return t('toolUpdateGoals');
  if (name === 'update_goal_profile') return t('toolUpdateGoalProfile');
  if (name === 'recalculate_goals_from_profile') return t('toolRecalculateGoals');
  if (name === 'web_search') return t('toolWebSearch');
  return t('toolFallback', { tool: name.replaceAll('_', ' ') });
}

function ActionRow(props: { action: ChatAction; busy: boolean; onUndo: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const details = actionDetails(props.action, locale);
  const label = props.action.undone ? t('actionUndone', { action: props.action.label }) : props.action.label;
  return (
    <View style={styles.actionReceipt}>
      <View style={styles.actionRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${locale === 'ru' ? 'Что изменилось' : 'What changed'}`} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.receiptToggle}>
          <Ionicons name={props.action.undone ? 'arrow-undo-outline' : 'checkmark'} size={17} color={props.action.undone ? color.muted : color.action} />
          <View style={{ flex: 1 }}><Text style={[styles.actionLabel, props.action.undone && styles.actionUndone]}>{label}</Text><Text style={styles.receiptHint}>{locale === 'ru' ? 'Что изменилось' : 'What changed'}{details.length > 0 ? ` · ${details.length}` : ''}</Text></View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={color.action} />
        </Pressable>
        {!props.action.undone && props.action.canUndo !== false && <Pressable accessibilityRole="button" accessibilityState={{ disabled: props.busy }} disabled={props.busy} onPress={props.onUndo} style={styles.receiptUndo}><Text style={styles.undo}>{props.busy ? t('undoing') : t('undo')}</Text></Pressable>}
      </View>
      {expanded && <View style={styles.receiptDetails}>
        <Text selectable style={styles.receiptHint}>{props.action.undone ? (locale === 'ru' ? 'Изменение отменено. Ниже — исходное действие.' : 'Undone. Original action shown below.') : (locale === 'ru' ? 'Было → Стало' : 'Before → After')}</Text>
        {details.length === 0 ? <Text selectable style={styles.receiptValue}>{locale === 'ru' ? 'Подробности изменения в этой записи не сохранены.' : 'Change details were not saved for this action.'}</Text> : details.map((detail) => <View key={detail.label} style={styles.receiptDetail}>
          <Text selectable style={styles.receiptField}>{detail.label}</Text>
          <Text selectable style={styles.receiptBefore}>{detail.before ?? '—'}</Text>
          <Text selectable style={styles.receiptValue}>→ {detail.after ?? '—'}</Text>
        </View>)}
      </View>}
    </View>
  );
}

function measureInWindow(view: { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void } | null): Promise<{ x: number; y: number; width: number; height: number } | undefined> {
  if (!view) return Promise.resolve(undefined);
  return new Promise((resolve) => view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height })));
}

async function storeAttachment(asset: ImagePicker.ImagePickerAsset): Promise<ChatAttachment> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const mimeType = asset.mimeType ?? 'image/jpeg';
  const extension = mimeType.includes('png') ? 'png' : 'jpg';
  const directory = new Directory(Paths.document, 'chat-attachments');
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(directory, `${id}.${extension}`);
  await new File(asset.uri).copy(destination);
  return { id, uri: destination.uri, mimeType, createdAt: Date.now() };
}

const styles = StyleSheet.create({
  actionReceipt: { backgroundColor: color.actionSoft, borderRadius: 14, overflow: 'hidden' },
  receiptToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  receiptUndo: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 6 },
  receiptHint: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  receiptDetails: { padding: 16, paddingTop: 0 }, receiptDetail: { marginTop: 14, gap: 4 },
  receiptField: { color: color.ink, fontFamily: type.ticket, fontSize: 13 }, receiptBefore: { color: color.muted, fontSize: 14, lineHeight: 20 }, receiptValue: { color: color.ink, fontSize: 14, lineHeight: 20 },

  stepsGroup: { marginTop: 6 },
  stepsToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  stepsLabel: { color: color.muted, fontSize: 12, flex: 1 },
  safeArea: { backgroundColor: color.canvas, flex: 1 },
  screen: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', height: 60, justifyContent: 'space-between', paddingHorizontal: space.sm },
  historyHeader: { alignItems: 'center', flexDirection: 'row', height: 60, justifyContent: 'space-between', paddingHorizontal: space.sm },
  headerTitle: { color: color.ink, flex: 1, fontFamily: type.ticketBold, fontSize: 21, textAlign: 'center' },
  mealContext: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', marginHorizontal: space.md, minHeight: 58, paddingBottom: space.sm },
  mealContextPhoto: { borderRadius: radius.image, height: 42, width: 42 },
  mealContextCopy: { flex: 1, marginLeft: space.sm, minWidth: 0 },
  mealContextLabel: { color: color.muted, fontFamily: type.ticket, fontSize: 11, letterSpacing: 0.5 },
  mealContextTitle: { color: color.ink, fontFamily: type.ticketBold, fontSize: 17, marginTop: 2 },
  feedScroll: { flex: 1 },
  feed: { flexGrow: 1, gap: 18, paddingBottom: space.md, paddingHorizontal: 20, paddingTop: 16 },
  empty: { flex: 1, justifyContent: 'center', minHeight: 240, paddingHorizontal: space.sm },
  emptyMark: { alignItems: 'center', backgroundColor: color.actionSoft, borderRadius: 18, height: 52, justifyContent: 'center', width: 52 },
  emptyTitle: { color: color.ink, fontFamily: type.ticketBold, fontSize: 25, lineHeight: 31, marginTop: space.md },
  suggestions: { borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.lg },
  suggestion: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: space.xs },
  suggestionText: { color: color.ink, flex: 1, fontSize: 15, lineHeight: 21, marginRight: space.md },
  userWrap: { alignItems: 'flex-end' },
  userMessage: { backgroundColor: color.actionSoft, borderRadius: radius.surface, maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 11 },
  userText: { color: color.ink, fontSize: 15, lineHeight: 21 },
  messagePhotos: { gap: space.sm, marginBottom: space.sm },
  messagePhoto: { borderRadius: radius.image, height: 104, width: 104 },
  assistantMessage: { maxWidth: '94%', paddingHorizontal: 2 },
  questionMessage: { backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, maxWidth: '94%', padding: space.md },
  questionMessageLabel: { color: color.pending, fontFamily: type.ticketBold, fontSize: 13, letterSpacing: 0.35, marginBottom: 3 },
  questionMessageText: { color: color.ink, fontSize: 16, fontWeight: '600', lineHeight: 22, marginTop: 5 },
  working: { alignItems: 'center', flexDirection: 'row', gap: space.sm, paddingVertical: space.sm },
  workingText: { color: color.muted, fontSize: 13 },
  toolActivity: { alignItems: 'center', flexDirection: 'row', gap: space.sm, minHeight: 34, paddingVertical: 6 },
  toolActivityText: { color: color.muted, flexShrink: 1, fontSize: 13 },
  toolActivityError: { color: color.error },
  error: { color: color.error, fontSize: 13, lineHeight: 18 },
  actionRow: { backgroundColor: color.actionSoft, borderRadius: 12, alignItems: 'center', flexDirection: 'row', minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
  actionLabel: { color: color.ink, flex: 1, fontSize: 13, lineHeight: 18, marginHorizontal: space.sm },
  actionUndone: { color: color.muted },
  undo: { color: color.action, fontFamily: type.ticketBold, fontSize: 13, lineHeight: 18 },
  composerDock: { backgroundColor: color.canvas, paddingHorizontal: space.md, paddingTop: space.sm },
  composer: { alignItems: 'flex-end', backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 58, padding: 5 },
  attachButton: { alignItems: 'center', borderRadius: radius.control, height: 48, justifyContent: 'center', width: 44 },
  input: { color: color.ink, flex: 1, fontSize: 15, lineHeight: 20, maxHeight: 112, minHeight: 48, paddingHorizontal: space.sm, paddingVertical: 13 },
  sendButton: { alignItems: 'center', backgroundColor: color.action, borderRadius: radius.control, height: 48, justifyContent: 'center', width: 48 },
  sendPressed: { backgroundColor: color.actionPressed },
  disabled: { opacity: 0.4 },
  pressed: { backgroundColor: color.surfacePressed },
  attachments: { gap: space.sm, paddingBottom: space.sm },
  attachment: { borderRadius: radius.image, height: 58, width: 58 },
  removeAttachment: { alignItems: 'center', backgroundColor: color.cameraChrome, borderRadius: radius.round, height: 20, justifyContent: 'center', position: 'absolute', right: -4, top: -4, width: 20 },
  historyList: { paddingHorizontal: space.md },
  threadRow: { alignItems: 'center', borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 70, paddingVertical: space.xs },
  threadOpen: { alignItems: 'center', flex: 1, flexDirection: 'row', minHeight: 62, paddingHorizontal: space.xs },
  threadPressed: { backgroundColor: color.surfacePressed },
  threadCopy: { flex: 1, minWidth: 0 },
  threadTitle: { color: color.ink, fontFamily: type.ticketBold, fontSize: 16 },
  threadTime: { color: color.muted, fontSize: 12, marginTop: 4 },
  instructionsBackdrop: { backgroundColor: 'rgba(30, 33, 38, 0.58)', flex: 1, justifyContent: 'flex-end' },
  instructionsSafeArea: { padding: space.md },
  instructionsSheet: { backgroundColor: color.surface, borderRadius: radius.surface, padding: space.md },
  instructionsTitle: { color: color.ink, fontFamily: type.ticketBold, fontSize: 25, lineHeight: 29 },
  instructionsHelp: { color: color.muted, fontSize: 14, lineHeight: 20, marginTop: space.xs },
  instructionsInput: { backgroundColor: color.canvas, borderColor: color.line, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, color: color.ink, fontSize: 15, lineHeight: 21, marginTop: space.md, minHeight: 136, padding: 13 },
  instructionsActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  instructionsSecondary: { alignItems: 'center', borderColor: color.line, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, flex: 1, justifyContent: 'center', minHeight: 50 },
  instructionsSecondaryText: { color: color.muted, fontFamily: type.ticketBold, fontSize: 16 },
  instructionsPrimary: { alignItems: 'center', backgroundColor: color.action, borderRadius: radius.control, flex: 1, justifyContent: 'center', minHeight: 50 },
  instructionsPrimaryText: { color: color.surface, fontFamily: type.ticketBold, fontSize: 16 },
});
