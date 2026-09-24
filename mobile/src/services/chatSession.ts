import { confirmationForTurn } from './mealConfirmation';
import { submitMealAnswer } from './mealAnswerSubmission';
import { runAgentTurn } from './agentTurn';
import { readAgentQuestions, subscribeAgentQuestions } from '../data/agentQuestionRepository';
import type { AgentQuestion } from '../domain/agentQuestion';
import { pendingAgentTurn, recordAgentResearch } from '../data/agentTurnRepository';
import type { ToolExecution } from '../features/chat/activityFeed';
import { readProviderActivities, retainProviderActivities, type ChatProviderActivity } from '../domain/chatActivity';
import { AppState } from 'react-native';
import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { File } from 'expo-file-system';

import { createChatAgent, getThinkingLevel, getWebSearchEnabled } from '../ai/piClient';
import { recordToolDiagnostic } from '../ai/requestDiagnostics';
import { createCalDoneTools } from '../ai/chatTools';
import { buildChatPrompt, CHAT_PROMPT_VERSION } from '../ai/chatPrompt';
import {
  getChatAction,
  listChatActions,
  loadChatMessages,
  markChatActionUndone,
  renameChatThread,
  sanitizeChatMessage,
  saveChatMessages,
} from '../data/chatRepository';
import { appendDiagnosticEvent, deleteMeal, getDailyGoals, getGoalProfile, getMeal, getPreference, removePreference, replaceMeal, saveDailyGoals, saveGoalProfile } from '../data/mealRepository';
import type { ChatAction, ChatAttachment, ChatThread, ChatUserMessage, ChatSendOptions } from '../domain/chat';
import { locale } from '../i18n';
import { mealActivityStartedAt, setMealActivity, subscribeMealActivity, type MealActivityStage } from './mealActivity';
import { acquireChatSessionLease, subscribeToChatAgent } from './chatAgentEvents';
import { beginForegroundWork } from './foregroundWork';

export type ChatSessionSnapshot = {
  messages: AgentMessage[];
  streamingMessage?: AgentMessage;
  actions: ChatAction[];
  providerActivities: ChatProviderActivity[];
  toolExecutions?: Record<string, ToolExecution>;
  busy: boolean;
  mealActivity?: MealActivityStage;
  workStartedAt?: number;
  recovering?: boolean;
  questions?: AgentQuestion[];
  error?: string;
};

export type ChatSession = {
  send(text: string, attachments: ChatAttachment[], options?: ChatSendOptions): Promise<void>;
  retry(): Promise<void>;
  abort(): void;
  /** Detach this screen. An in-flight turn remains owned by the conversation. */
  close(): Promise<void>;
};

type OpenChatSessionInput = {
  thread: ChatThread;
  selectedMealId?: string;
  selectedMealQuestions?: string[];
  onChanged: (snapshot: ChatSessionSnapshot) => void;
  onDataChanged: () => Promise<void>;
};

type RetainedSession = {
  session: ChatSession;
  listeners: Set<OpenChatSessionInput['onChanged']>;
  dataListeners: Set<OpenChatSessionInput['onDataChanged']>;
  snapshot?: ChatSessionSnapshot;
  undoneActionIds: Set<string>;
  running: boolean;
  publish(): void;
  disposeIfIdle(): Promise<void>;
};
const retainedSessions = new Map<string, Promise<RetainedSession>>();

/** Screens observe a conversation; navigation must never act as the Stop button.
 * Keep the agent until its turn settles, allowing a new screen to reattach. */
export async function openChatSession(input: OpenChatSessionInput): Promise<ChatSession> {
  let pending = retainedSessions.get(input.thread.id);
  if (!pending) {
    pending = createRetainedSession(input);
    retainedSessions.set(input.thread.id, pending);
  }
  const entry = await pending;
  let attached = true;
  entry.listeners.add(input.onChanged);
  entry.dataListeners.add(input.onDataChanged);
  entry.publish();
  const run = async (action: () => Promise<void>) => {
    if (!attached) throw new Error('Conversation is closed.');
    if (entry.running || entry.snapshot?.mealActivity) throw new Error('This meal already has a request in progress.');
    entry.running = true;
    entry.publish();
    let release: (() => Promise<void>) | undefined;
    try {
      release = await beginForegroundWork();
      await action();
    } finally {
      await release?.().catch(() => undefined);
      entry.running = false;
      entry.publish();
      await entry.disposeIfIdle();
    }
  };
  return {
    send: (text, attachments, options) => run(() => entry.session.send(text, attachments, options)),
    retry: () => run(() => entry.session.retry()),
    abort: () => { if (attached) entry.session.abort(); },
    close: async () => {
      attached = false;
      entry.listeners.delete(input.onChanged);
      entry.dataListeners.delete(input.onDataChanged);
      await entry.disposeIfIdle();
    },
  };
}

async function createRetainedSession(input: OpenChatSessionInput): Promise<RetainedSession> {
  let disposed = false;
  const entry: RetainedSession = {
    session: undefined as unknown as ChatSession,
    listeners: new Set(), dataListeners: new Set(), running: false, undoneActionIds: new Set(),
    publish() {
      if (entry.snapshot) for (const listener of entry.listeners) {
        // Undo is durable and cannot be reversed by an older in-flight action reload.
        listener({ ...entry.snapshot,
          actions: entry.snapshot.actions.map(action => entry.undoneActionIds.has(action.id) ? { ...action, undone: true } : action),
          busy: entry.running || entry.snapshot.busy });
      }
    },
    async disposeIfIdle() {
      if (disposed || entry.running || entry.listeners.size) return;
      disposed = true;
      retainedSessions.delete(input.thread.id);
      await entry.session.close();
    },
  };
  try {
    entry.session = await openOwnedChatSession({ ...input,
      // A foreground screen may attach after capture created the owner. Notify
      // current observers, including on later turns after that caller detaches.
      onDataChanged: async () => {
        // These callbacks refresh screens after authoritative work has finished.
        // A failed observer cannot undo that work or cause the agent to repeat it.
        const results = await Promise.allSettled([...entry.dataListeners].map(listener => Promise.resolve().then(listener)));
        if (results.some(result => result.status === 'rejected')) await appendDiagnosticEvent({
          id: `${Date.now()}-screen-refresh`, createdAt: Date.now(), operation: 'observer_error',
          threadId: input.thread.id, stage: 'screen_refresh',
        }).catch(() => undefined);
      },
      onChanged: snapshot => {
      entry.snapshot = snapshot;
      entry.publish();
    } });
    return entry;
  } catch (error) {
    retainedSessions.delete(input.thread.id);
    throw error;
  }
}

async function openOwnedChatSession(input: OpenChatSessionInput): Promise<ChatSession> {
  const releaseLease = await acquireChatSessionLease(input.thread.id);
  try {
    return await createOpenChatSession(input, releaseLease);
  } catch (error) {
    releaseLease();
    throw error;
  }
}

async function createOpenChatSession(input: OpenChatSessionInput, releaseLease: () => void): Promise<ChatSession> {
  const [messages, customInstructions] = await Promise.all([
    loadChatMessages(input.thread.id),
    getPreference('assistant_custom_instructions'),
  ]);
  const attachmentMap = collectAttachments(messages);
  let actions = await listChatActions(input.thread.id);
  let threadTitle = input.thread.title;
  let turnStartedAt = Date.now();
  let agent: Agent;
  let closed = false;
  let mealActivity: MealActivityStage | undefined;
  const toolExecutions: Record<string, ToolExecution> = {};
  const providerActivities = new Map(readProviderActivities(messages).map(activity => [activity.id, activity]));
  const syncActivity = () => {
    // The turn owns the busy lifetime; actual execution events own its label.
    // Never start another lifetime from a late provider observer.
    if (!mealActivity) return;
    const tool = Object.values(toolExecutions).findLast(tool => tool.status === 'running');
    const stages: Record<string, MealActivityStage> = { view_meal_photos: 'reading_photos', get_meal: 'reviewing_meal',
      edit_meal: 'saving_result', create_meal: 'saving_result', delete_meal: 'saving_result' };
    const stage = tool ? stages[tool.name ?? ''] ?? 'thinking'
      : [...providerActivities.values()].some(activity => activity.status === 'active') ? 'web_search' : 'thinking';
    if (stage !== mealActivity) setMealActivity(input.selectedMealId ?? input.thread.mealId!, stage);
  };
  let persistTask: Promise<void> = Promise.resolve();
  let hasSent = false;
  let recovering = false;
  let recoveryAbort = new AbortController();
  let questions = await readAgentQuestions({threadId:input.thread.id,mealId:input.selectedMealId??input.thread.mealId});
  const interrupted = await pendingAgentTurn({threadId:input.thread.id});
  let turnError = interrupted ? interrupted.error ?? (locale === 'ru'
    ? 'Предыдущий запрос был прерван. Повторите его, чтобы продолжить.'
    : 'The previous request was interrupted. Retry it to continue.') : undefined;

  const emit = () => input.onChanged({
    messages: agent.state.messages,
    // Hide generated confirmation prose while it streams; the completed reply
    // is replaced with the app-owned receipt before display or persistence.
    streamingMessage: confirmationForTurn(agent.state.messages) && agent.state.streamingMessage?.role === 'assistant'
      ? { ...agent.state.streamingMessage, content: agent.state.streamingMessage.content.filter(block => block.type !== 'text') }
      : agent.state.streamingMessage,
    actions,
    toolExecutions: { ...toolExecutions },
    providerActivities: [...providerActivities.values()],
    busy: agent.state.isStreaming || recovering,
    mealActivity,
    workStartedAt: mealActivity ? mealActivityStartedAt(input.selectedMealId ?? input.thread.mealId ?? '')
      : agent.state.isStreaming || recovering ? turnStartedAt : undefined,
    recovering,
    questions,
    error: turnError ?? agent.state.errorMessage ?? (() => {
      const last = agent.state.messages.at(-1);
      return last?.role === 'assistant' && last.stopReason === 'error' ? last.errorMessage : undefined;
    })(),
  });

  const refreshQuestions = async () => {
    questions = await readAgentQuestions({threadId:input.thread.id,mealId:input.selectedMealId??input.thread.mealId});
    if (!closed) emit();
  };
  const unsubscribeQuestions = subscribeAgentQuestions(()=>{void refreshQuestions().catch(()=>undefined);});

  agent = await createChatAgent({
    systemPrompt: buildChatPrompt({
      language: locale === 'ru' ? 'Russian' : 'English',
      selectedMealId: input.selectedMealId,
      selectedMealQuestions: input.selectedMealQuestions,
      customInstructions,
      now: Date.now(),
    }),
    messages,
    sessionId: input.thread.id,
    onResearch:research=>recordAgentResearch(input.thread.id,research),
    onProviderActivity: (activity) => {
      if (closed || recoveryAbort.signal.aborted || !agent.state.isStreaming) return;
      const previous = providerActivities.get(activity.id);
      providerActivities.set(activity.id, { ...activity,
        messageIndex: previous?.messageIndex ?? agent.state.messages.length,
        blockIndex: previous?.blockIndex ?? (agent.state.streamingMessage?.role === 'assistant'
          ? agent.state.streamingMessage.content.filter(block => block.type !== 'thinking').length : 0),
      });
      syncActivity();
      emit();
    },
    tools: createCalDoneTools({
      threadId: input.thread.id,
      mealId:input.selectedMealId??input.thread.mealId,
      getResearch:async()=>(await pendingAgentTurn({threadId:input.thread.id}))?.research??{status:'not_searched',sources:[]},
      attachments: attachmentMap,
      getMessages: () => agent.state.messages,
      onDataChanged: async () => {
        await input.onDataChanged();
        await refreshQuestions();
        emit();
      },
    }),
  });

  const persist = () => {
    const snapshot = agent.state.messages.map(sanitizeChatMessage);
    persistTask = persistTask.catch(() => undefined).then(() => saveChatMessages(input.thread.id, snapshot));
    return persistTask;
  };

  const unsubscribe = subscribeToChatAgent(agent, (event) => {
    if (event.type === 'tool_execution_start') {
      toolExecutions[event.toolCallId] = { status: 'running', arguments: event.args, name: event.toolName };
      syncActivity();
      void recordToolDiagnostic({threadId: input.thread.id, toolCallId: event.toolCallId, toolName: event.toolName, phase: 'started', value: event.args}, appendDiagnosticEvent);
    }
    if (event.type === 'tool_execution_end') {
      void recordToolDiagnostic({threadId: input.thread.id, toolCallId: event.toolCallId, toolName: event.toolName, phase: 'completed', isError: event.isError, value: event.result}, appendDiagnosticEvent);
      const execution = toolExecutions[event.toolCallId];
      if (execution) toolExecutions[event.toolCallId] = { ...execution, status: recoveryAbort.signal.aborted ? 'cancelled' : event.isError ? 'failed' : 'completed' };
      syncActivity();
      void listChatActions(input.thread.id).then((next) => {
        actions = next;
        emit();
      }).catch(() => undefined);
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const confirmation = confirmationForTurn(agent.state.messages);
      if (confirmation && event.message.stopReason === 'stop') event.message.content = [{type:'text',text:confirmation}];
      void recordChatDiagnostic(input.thread.id, turnStartedAt, event.message);
    }
    if (event.type === 'agent_end') {
      for (const [id, execution] of Object.entries(toolExecutions)) {
        if (execution.status === 'running') toolExecutions[id] = { ...execution, status: 'cancelled' };
      }
      for (const [id, activity] of providerActivities) {
        if (activity.status === 'active') {
          providerActivities.set(id, { ...activity, status: recoveryAbort.signal.aborted ? 'cancelled' : agent.state.errorMessage ? 'error' : 'complete' });
        }
      }
      syncActivity();
    }
    if (event.type === 'message_end' || event.type === 'agent_end') {
      agent.state.messages = retainProviderActivities(agent.state.messages.map(sanitizeChatMessage), [...providerActivities.values()]);
    }
    emit();
  });
  // One activity owner covers capture, form replies and chat. A secondary
  // historical conversation observes the same meal without replacing history.
  const unsubscribeMeal = subscribeMealActivity((activities) => {
    mealActivity = activities.get(input.selectedMealId ?? input.thread.mealId ?? '');
    emit();
  });
  emit();

  const session: ChatSession = {
    send: async (text, attachments, options) => {
      if (mealActivity || recovering || agent.state.isStreaming) return;
      const cleanText = text.trim();
      if (!cleanText && attachments.length === 0) return;
      emit();
      attachments.forEach((attachment) => attachmentMap.set(attachment.id, attachment));
      if (!threadTitle) {
        const title = cleanText || (locale === 'ru' ? 'Разговор о фото' : 'Photo conversation');
        threadTitle = title.slice(0, 44);
        await renameChatThread(input.thread.id, threadTitle);
      }
      const message: ChatUserMessage = {
        role: 'chatUser',
        text: cleanText || (locale === 'ru' ? 'Посмотри на прикреплённое фото.' : 'Look at the attached photo.'),
        attachments,
        timestamp: Date.now(),
        id: options?.requestId ?? `message:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
        questionAnswers: options?.questionAnswers,
        source: options?.source ?? 'chat',
      };
      turnStartedAt = Date.now();
      hasSent = true;
      turnError = undefined;
      recoveryAbort = new AbortController();
      try {
        const mealId = input.selectedMealId ?? input.thread.mealId;
        const run = async () => {
          try {
            await runAgentTurn({agent,threadId:input.thread.id,mealId,message,signal:recoveryAbort.signal});
          } finally { await input.onDataChanged(); }
        };
        if (mealId) await submitMealAnswer(mealId, run);
        else await run();
      } catch (error) {
        turnError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        emit();
      }
    },
    retry: async () => {
      if (mealActivity || recovering || agent.state.isStreaming) return;
      recoveryAbort = new AbortController();
      recovering = true;
      turnError = undefined;
      hasSent = true;
      turnStartedAt = Date.now();
      emit();
      try {await runAgentTurn({agent,threadId:input.thread.id,mealId:input.selectedMealId??input.thread.mealId,signal:recoveryAbort.signal});}
      catch(error){turnError=error instanceof Error?error.message:String(error);throw error;}
      finally {recovering=false;await input.onDataChanged();emit();}
    },
    abort: () => { recoveryAbort.abort(); agent.abort(); },
    close: async () => {
      if (closed) return;
      closed = true;
      unsubscribeMeal();
      unsubscribeQuestions();
      recoveryAbort.abort();
      agent.abort();
      await agent.waitForIdle().catch(() => undefined);
      agent.state.messages = agent.state.messages.map(sanitizeChatMessage);
      if (hasSent && !mealActivity) await persist().catch(() => undefined);
      unsubscribe();
      releaseLease();
    },
  };
  return session;
}

async function recordChatDiagnostic(threadId: string, startedAt: number, response: AssistantMessage): Promise<void> {
  const [thinkingLevel, webSearchEnabled] = await Promise.all([
    getThinkingLevel(response.provider, response.model),
    getWebSearchEnabled(response.provider),
  ]);
  await appendDiagnosticEvent({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: Date.now(),
    operation: 'chat',
    appState: AppState.currentState,
    threadId,
    provider: response.provider,
    model: response.model,
    api: response.api,
    promptVersion: CHAT_PROMPT_VERSION,
    thinkingLevel,
    webSearchEnabled,
    durationMs: Date.now() - startedAt,
    responseId: response.responseId,
    stopReason: response.stopReason,
    usage: response.usage,
    contentTypes: response.content.map((block) => block.type),
    toolNames: response.content.flatMap((block) => block.type === 'toolCall' ? [block.name] : []),
    outputText: response.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n'),
    error: response.errorMessage,
  }).catch(() => undefined);
}

export async function undoAssistantAction(actionId: string): Promise<void> {
  const action = await getChatAction(actionId);
  if (!action || action.undone || action.canUndo === false || action.undo.kind === 'imported') return;
  if (action.undo.kind === 'restore_meal') {
    const current = await getMeal(action.undo.meal.id);
    if (action.undo.expectedMeal && !sameValue(current, action.undo.expectedMeal)) throw new Error('Meal changed after this action');
    await replaceMeal(action.undo.meal);
    const restoredUris = new Set(action.undo.meal.photos.map((photo) => photo.uri));
    for (const photo of current?.photos ?? []) {
      if (restoredUris.has(photo.uri)) continue;
      try { new File(photo.uri).delete(); } catch { /* Best-effort cleanup. */ }
    }
  } else if (action.undo.kind === 'delete_meal') {
    const meal = await getMeal(action.undo.mealId);
    if (action.undo.expectedMeal && !sameValue(meal, action.undo.expectedMeal)) throw new Error('Meal changed after this action');
    await deleteMeal(action.undo.mealId);
    for (const photo of meal?.photos ?? []) {
      try { new File(photo.uri).delete(); } catch { /* Best-effort cleanup of assistant-created photos. */ }
    }
  } else if (action.undo.kind === 'restore_goals') {
    const current = await getDailyGoals();
    if (action.undo.expectedGoals && !sameValue(current, action.undo.expectedGoals)) throw new Error('Goals changed after this action');
    await saveDailyGoals(action.undo.goals);
  } else if (action.undo.kind === 'restore_goal_profile') {
    const current = await getGoalProfile();
    if (action.undo.expectedProfile && !sameValue(current, action.undo.expectedProfile)) throw new Error('Goal profile changed after this action');
    if (action.undo.profile) await saveGoalProfile(action.undo.profile);
    else await removePreference('goal_profile');
  }
  await markChatActionUndone(action.id);
  const pending = retainedSessions.get(action.threadId);
  if (pending) {
    const entry = await pending;
    entry.undoneActionIds.add(action.id);
    entry.publish();
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function collectAttachments(messages: AgentMessage[]): Map<string, ChatAttachment> {
  const attachments = new Map<string, ChatAttachment>();
  for (const message of messages) {
    if (message.role !== 'chatUser') continue;
    message.attachments.forEach((attachment) => attachments.set(attachment.id, attachment));
  }
  return attachments;
}
