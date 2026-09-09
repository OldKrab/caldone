import { confirmationForTurn } from './mealConfirmation';
import { submitMealAnswer } from './mealAnswerSubmission';
import type { ToolExecution } from '../features/chat/activityFeed';
import { AppState } from 'react-native';
import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { File } from 'expo-file-system';

import { createChatAgent, getThinkingLevel, getWebSearchEnabled } from '../ai/piClient';
import type { ProviderToolActivity } from '../ai/providerActivity';
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
import type { ChatAction, ChatAttachment, ChatThread, ChatUserMessage } from '../domain/chat';
import { mealQuestions } from '../domain/meal';
import { locale } from '../i18n';
import { continuationMessages, isConnectionError } from './connectionRecovery';
import { waitForConnectionRecovery } from './foregroundRecovery';
import { subscribeMealActivity, type MealActivityStage } from './mealActivity';
import { acquireChatSessionLease, subscribeToChatAgent } from './chatAgentEvents';
import { beginForegroundWork } from './foregroundWork';

export type ChatSessionSnapshot = {
  messages: AgentMessage[];
  streamingMessage?: AgentMessage;
  actions: ChatAction[];
  providerActivities: ProviderToolActivity[];
  toolExecutions?: Record<string, ToolExecution>;
  busy: boolean;
  mealActivity?: MealActivityStage;
  recovering?: boolean;
  error?: string;
};

export type ChatSession = {
  send(text: string, attachments: ChatAttachment[]): Promise<void>;
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
  snapshot?: ChatSessionSnapshot;
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
  entry.publish();
  const run = async (action: () => Promise<void>) => {
    if (!attached || entry.running || entry.snapshot?.mealActivity) return;
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
    send: (text, attachments) => run(() => entry.session.send(text, attachments)),
    retry: () => run(() => entry.session.retry()),
    abort: () => { if (attached) entry.session.abort(); },
    close: async () => {
      attached = false;
      entry.listeners.delete(input.onChanged);
      await entry.disposeIfIdle();
    },
  };
}

async function createRetainedSession(input: OpenChatSessionInput): Promise<RetainedSession> {
  let disposed = false;
  const entry: RetainedSession = {
    session: undefined as unknown as ChatSession,
    listeners: new Set(), running: false,
    publish() {
      if (entry.snapshot) for (const listener of entry.listeners) {
        listener({ ...entry.snapshot, busy: entry.running || entry.snapshot.busy });
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
    entry.session = await openOwnedChatSession({ ...input, onChanged: snapshot => {
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
  let reloadTask: Promise<void> = Promise.resolve();
  const toolExecutions: Record<string, ToolExecution> = {};
  const providerActivities = new Map<string, ProviderToolActivity>();
  let persistTask: Promise<void> = Promise.resolve();
  let hasSent = false;
  let recovering = false;
  let answering = false;
  let answerWasRouted = false;
  let answerError: string | undefined;
  let recoveryAbort = new AbortController();

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
    busy: agent.state.isStreaming || recovering || answering,
    mealActivity,
    recovering,
    error: answerWasRouted ? answerError : agent.state.errorMessage ?? (() => {
      const last = agent.state.messages.at(-1);
      if (last?.role === 'toolResult' && last.isError && last.toolName === 'answer_meal_question') {
        return last.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
      }
      return last?.role === 'assistant' && last.stopReason === 'error' ? last.errorMessage : undefined;
    })(),
  });

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
    onProviderActivity: (activity) => {
      if (closed) return;
      providerActivities.set(activity.id, activity);
      emit();
    },
    tools: createCalDoneTools({
      threadId: input.thread.id,
      attachments: attachmentMap,
      getMessages: () => agent.state.messages,
      onDataChanged: async () => {
        // Analysis may append remaining questions while the agent is running.
        // Merge only those durable messages; never replace its active tool loop.
        const stored = await loadChatMessages(input.thread.id);
        const existing = new Set(agent.state.messages.filter(message => message.role === 'mealQuestion').map(message => JSON.stringify(message)));
        for (const message of stored) {
          if (message.role === 'mealQuestion' && !existing.has(JSON.stringify(message))) agent.state.messages.push(message);
        }
        await input.onDataChanged();
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
      toolExecutions[event.toolCallId] = { status: 'running', arguments: event.args };
    }
    if (event.type === 'tool_execution_end') {
      const execution = toolExecutions[event.toolCallId];
      if (execution) toolExecutions[event.toolCallId] = { ...execution, status: recoveryAbort.signal.aborted ? 'cancelled' : event.isError ? 'failed' : 'completed' };
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
    if (event.type === 'message_end' || event.type === 'agent_end') {
      agent.state.messages = agent.state.messages.map(sanitizeChatMessage);
      void persist().catch(() => undefined);
    }
    if (event.type === 'agent_end') {
      for (const [id, execution] of Object.entries(toolExecutions)) {
        if (execution.status === 'running') toolExecutions[id] = { ...execution, status: 'cancelled' };
      }
      for (const [id, activity] of providerActivities) {
        if (activity.status === 'active') {
          providerActivities.set(id, { ...activity, status: agent.state.errorMessage ? 'error' : 'complete' });
        }
      }
    }
    emit();
  });
  // Inline answers run in the meal processor, outside this chat agent. Observe
  // their lifecycle so opening chat mid-request shows progress and fresh results.
  const unsubscribeMeal = subscribeMealActivity((activities) => {
    const previous = mealActivity;
    mealActivity = activities.get(input.selectedMealId ?? input.thread.mealId ?? '');
    if (previous && !mealActivity && !agent.state.isStreaming && !answering) {
      reloadTask = reloadTask.then(async () => {
        if (closed) return;
        const [messages, nextActions] = await Promise.all([
          loadChatMessages(input.thread.id), listChatActions(input.thread.id),
        ]);
        if (closed) return;
        agent.state.messages = messages;
        actions = nextActions;
        await input.onDataChanged();
        emit();
      }).catch(() => undefined);
    }
    emit();
  });
  emit();

  const retryFailedResponse = async (wait: boolean) => {
    const messages = continuationMessages(agent.state.messages);
    if (!messages || closed) return;
    recovering = true;
    emit();
    try {
      if (wait) await waitForConnectionRecovery(recoveryAbort.signal);
      if (closed || recoveryAbort.signal.aborted) return;
      agent.state.messages = messages;
      hasSent = true;
      turnStartedAt = Date.now();
      await agent.continue();
    } finally { recovering = false; emit(); }
  };

  // Composer text and button answers have the same meaning while a meal has
  // an open clarification. Execute the registered tool directly so routing is
  // deterministic and still retains its revision checks, receipt and Undo.
  const pendingMealId = () => input.selectedMealId ?? input.thread.mealId ??
    agent.state.messages.findLast(message => message.role === 'mealQuestion')?.mealId;
  const applicationMessage = (content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage => ({
    role: 'assistant', content, stopReason, timestamp: Date.now(),
    api: agent.state.model.api, provider: agent.state.model.provider, model: agent.state.model.id,
    // Application routing/receipts are not inference and incur no model usage.
    usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
  });
  const answerPendingQuestion = async (mealId: string | undefined, message?: ChatUserMessage): Promise<boolean> => {
    if (!mealId) return false;
    answering = true;
    let callId: string | undefined;
    try {
      const meal = await getMeal(mealId);
      if (!mealQuestions(meal?.analysis?.clarification).length) return false;
      const tool = agent.state.tools.find(tool => tool.name === 'answer_meal_question');
      if (!tool) throw new Error('Meal answer tool is unavailable');
      answerWasRouted = true;
      answerError = undefined;
      if (message) agent.state.messages.push(message);
      callId = `answer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const args = {mealId, expectedRevision: meal!.revision};
      agent.state.messages.push(applicationMessage([{type: 'toolCall', id: callId, name: tool.name, arguments: args}], 'toolUse'));
      toolExecutions[callId] = {status: 'running', arguments: args};
      emit();
      await persist();
      const result = await tool.execute(callId, args, recoveryAbort.signal);
      agent.state.messages.push({role: 'toolResult', toolCallId: callId, toolName: tool.name, ...result, isError: false, timestamp: Date.now()});
      toolExecutions[callId] = {...toolExecutions[callId], status: 'completed'};
      const next = await getMeal(mealId);
      const confirmation = confirmationForTurn(agent.state.messages);
      if (confirmation && !mealQuestions(next?.analysis?.clarification).length) {
        agent.state.messages.push(applicationMessage([{type: 'text', text: confirmation}], 'stop'));
      }
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      answerError = text;
      if (callId) {
        toolExecutions[callId] = {...toolExecutions[callId], status: recoveryAbort.signal.aborted ? 'cancelled' : 'failed'};
        agent.state.messages.push({role: 'toolResult', toolCallId: callId, toolName: 'answer_meal_question', isError: true, content: [{type: 'text', text}], timestamp: Date.now()});
      }
      throw error;
    } finally {
      try {
        if (callId) {
          await persist();
          actions = await listChatActions(input.thread.id);
          await input.onDataChanged();
        }
      } finally { answering = false; emit(); }
    }
  };

  const session: ChatSession = {
    send: async (text, attachments) => {
      if (mealActivity || recovering || answering || agent.state.isStreaming) return;
      await reloadTask;
      const cleanText = text.trim();
      if (!cleanText && attachments.length === 0) return;
      providerActivities.clear();
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
      };
      turnStartedAt = Date.now();
      hasSent = true;
      recoveryAbort = new AbortController();
      try {
        const mealId = input.selectedMealId ?? input.thread.mealId;
        const run = async () => {
          try {
            if (await answerPendingQuestion(pendingMealId(), message)) return;
            answerWasRouted = false;
            await agent.prompt(message);
            if (isConnectionError(agent.state.errorMessage)) await retryFailedResponse(true);
          } finally { await input.onDataChanged(); }
        };
        if (mealId) await submitMealAnswer(mealId, run);
        else await run();
      } finally {
        emit();
      }
    },
    retry: async () => {
      if (mealActivity || recovering || answering || agent.state.isStreaming) return;
      recoveryAbort = new AbortController();
      const last = agent.state.messages.at(-1);
      if (last?.role === 'toolResult' && last.isError && last.toolName === 'answer_meal_question') {
        await answerPendingQuestion(pendingMealId());
      } else await retryFailedResponse(false);
    },
    abort: () => { recoveryAbort.abort(); agent.abort(); },
    close: async () => {
      if (closed) return;
      await reloadTask;
      closed = true;
      unsubscribeMeal();
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
