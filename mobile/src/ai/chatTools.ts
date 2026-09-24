import { resolveMealWebImage } from '../services/mealWebImage';
import { createQuestionTools, questionSchema, resolutionSchema } from './questionTool';
import { commitMealAgentEdit } from '../data/mealAgentRepository';
import type { QuestionResolution } from '../domain/agentQuestion';
import type { QuestionChoices } from '../domain/questionChoices';
import type { MealResearch } from '../domain/mealResearch';
import { acceptMealResearch } from './mealResearchResult';
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { Directory, File, Paths } from 'expo-file-system';

import { getChatToolReceipt, recordChatAction, saveChatToolReceipt, retainedInputPhotoUris } from '../data/chatRepository';
import {
  appendDiagnosticEvent,
  deleteMealIfRevision,
  getDailyGoals,
  getGoalProfile,
  getMeal,
  listMeals,
  saveDailyGoals,
  saveGoalProfile,
  saveMealRecord,
} from '../data/mealRepository';
import { estimateDailyGoals, mergeGoalProfile, parseGoalProfile, type GoalProfile } from '../domain/goalEstimator';
import type { ChatAttachment } from '../domain/chat';
import type { DailyGoals, Meal, MealAnalysis, MealItem, MealPhoto, MealStatus } from '../domain/meal';
import { analysisFromItems, summarizeNutrition } from '../domain/mealOperations';
import { t } from '../i18n';
import { mealRequestContext } from './mealRequestContext';

type ActivityParams = { statusText?: string };
type SearchMealsParams = ActivityParams & { query?: string; from?: string; to?: string; statuses?: MealStatus[]; cursor?: string; limit?: number };
type GetMealParams = ActivityParams & { mealId: string };
type ViewMealPhotosParams = ActivityParams & { mealId: string; photoIds?: string[] };
type NutritionSummaryParams = ActivityParams & { from: string; to: string; groupByDay?: boolean; compareToGoals?: boolean };
type CreateMealParams = ActivityParams & {
  title: string; mealType: MealAnalysis['mealType']; capturedAt?: string; note?: string;
  items: MealItem[]; attachmentIds?: string[];
};
type EditMealParams = ActivityParams & {
  mealId: string; expectedRevision: number; capturedAt?: string; note?: string; title?: string;
  mealType?: MealAnalysis['mealType']; items?: MealItem[]; addAttachmentIds?: string[]; removePhotoIds?: string[];
  questions?: QuestionChoices[]; resolutions?: QuestionResolution[]; webImageSourceUrl?: string;
};
type MealMutationParams = ActivityParams & { mealId: string; expectedRevision: number };
type UpdateGoalsParams = ActivityParams & { calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null };
type UpdateGoalProfileParams = Partial<GoalProfile> & ActivityParams;

const activitySchema = Type.Optional(Type.String({
  description: 'Short user-facing present-tense description of this specific action. Plain text, no reasoning, IDs, arguments, or Markdown.',
  maxLength: 80,
}));
const nutritionSchema = {
  calories: Type.Number({ minimum: 0, maximum: 100_000 }),
  protein: Type.Number({ minimum: 0, maximum: 10_000 }),
  carbs: Type.Number({ minimum: 0, maximum: 10_000 }),
  fat: Type.Number({ minimum: 0, maximum: 10_000 }),
};
const itemSchema = Type.Object({ name: Type.String({ minLength: 1 }), quantity: Type.String({ minLength: 1 }), ...nutritionSchema }, { additionalProperties: false });
const mealTypeSchema = Type.Union([Type.Literal('breakfast'), Type.Literal('lunch'), Type.Literal('dinner'), Type.Literal('snack')]);
const mealStatusSchema = Type.Union([
  Type.Literal('queued'), Type.Literal('analyzing'), Type.Literal('needs_input'),
  Type.Literal('complete'), Type.Literal('estimated'), Type.Literal('failed'),
]);

export function createCalDoneTools(input: {
  threadId: string;
  mealId?: string;
  getResearch?: ()=>Promise<MealResearch>;
  getMessages: () => AgentMessage[];
  attachments: Map<string, ChatAttachment>;
  onDataChanged: () => Promise<void>;
}): AgentTool[] {
  return [
    ...createQuestionTools(input),
    {
      name: 'search_meals',
      label: 'Search meals',
      description: 'Search meal history and return compact current records. Use before referring to a meal unless its exact ID and revision are already known.',
      parameters: Type.Object({
        query: Type.Optional(Type.String()),
        from: Type.Optional(Type.String({ description: 'Inclusive local date or ISO timestamp.' })),
        to: Type.Optional(Type.String({ description: 'Inclusive local date or ISO timestamp.' })),
        statuses: Type.Optional(Type.Array(mealStatusSchema)),
        cursor: Type.Optional(Type.String({ description: 'Opaque cursor returned by the previous search.' })),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
        statusText: activitySchema,
      }, { additionalProperties: false }),
      execute: async (_id, rawParams) => {
        const params = rawParams as SearchMealsParams;
        const query = params.query?.trim().toLocaleLowerCase();
        const from = parseBoundary(params.from, false);
        const to = parseBoundary(params.to, true);
        const statuses = new Set(params.statuses ?? []);
        const matches = (await listMeals()).filter((meal) => {
          if (from !== undefined && meal.capturedAt < from) return false;
          if (to !== undefined && meal.capturedAt > to) return false;
          if (statuses.size > 0 && !statuses.has(meal.status)) return false;
          if (!query) return true;
          const haystack = [meal.analysis?.title, meal.note, ...meal.analysis?.items.map((item) => item.name) ?? []]
            .filter(Boolean).join(' ').toLocaleLowerCase();
          return haystack.includes(query);
        });
        const offset = parseCursor(params.cursor);
        const limit = params.limit ?? 30;
        const page = matches.slice(offset, offset + limit);
        return jsonResult({
          meals: page.map(mealSummary),
          totalCount: matches.length,
          nextCursor: offset + page.length < matches.length ? String(offset + page.length) : undefined,
        });
      },
    },
    {
      name: 'get_meal',
      label: 'View meal',
      description: 'Get the complete current structured record for one meal. Use view_meal_photos separately when visual inspection is needed.',
      parameters: Type.Object({ mealId: Type.String(), statusText: activitySchema }, { additionalProperties: false }),
      execute: async (_id, rawParams) => jsonResult(mealForTool(await requiredMeal((rawParams as GetMealParams).mealId))),
    },
    {
      name: 'view_meal_photos',
      label: 'View meal photos',
      description: 'Visually inspect all photos for a meal, or only selected stable photo IDs returned by get_meal.',
      parameters: Type.Object({
        mealId: Type.String(),
        photoIds: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
        statusText: activitySchema,
      }, { additionalProperties: false }),
      execute: async (_id, rawParams) => {
        const params = rawParams as ViewMealPhotosParams;
        const meal = await requiredMeal(params.mealId);
        const requested = params.photoIds ? new Set(params.photoIds) : undefined;
        const photos = requested ? meal.photos.filter((photo) => requested.has(photo.id)) : meal.photos;
        if (requested && photos.length !== requested.size) throw new Error('One or more meal photos were not found. Read the meal again.');
        if (photos.length === 0) throw new Error('This meal has no saved photos.');
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ mealId: meal.id, photoIds: photos.map((photo) => photo.id) }) },
            ...await Promise.all(photos.map(async (photo) => ({ type: 'image' as const, data: await new File(photo.uri).base64(), mimeType: photo.mimeType }))),
          ],
          details: { mealId: meal.id, photoIds: photos.map((photo) => photo.id) },
        };
      },
    },
    {
      name: 'summarize_nutrition',
      label: 'Summarize nutrition',
      description: 'Calculate meal count, totals, averages across logged days, optional per-day values, and optional differences from daily goals for a date range. Never treats missing days as zero intake.',
      parameters: Type.Object({
        from: Type.String({ description: 'Inclusive local date or ISO timestamp.' }),
        to: Type.String({ description: 'Inclusive local date or ISO timestamp.' }),
        groupByDay: Type.Optional(Type.Boolean()),
        compareToGoals: Type.Optional(Type.Boolean()),
        statusText: activitySchema,
      }, { additionalProperties: false }),
      execute: async (_id, rawParams) => {
        const params = rawParams as NutritionSummaryParams;
        return jsonResult(summarizeNutrition(await listMeals(), {
          from: requiredBoundary(params.from, false),
          to: requiredBoundary(params.to, true),
          goals: params.compareToGoals ? await getDailyGoals() : undefined,
          groupByDay: params.groupByDay,
        }));
      },
    },
    {
      name: 'get_goals',
      label: 'View goals',
      description: 'Read the user-controlled daily calorie and macro goals.',
      parameters: Type.Object({ statusText: activitySchema }, { additionalProperties: false }),
      execute: async () => jsonResult({ goals: await getDailyGoals() }),
    },
    {
      name: 'get_goal_profile',
      label: 'View goal profile',
      description: 'Read saved profile inputs only when the user asks about profile-based goals.',
      parameters: Type.Object({ statusText: activitySchema }, { additionalProperties: false }),
      execute: async () => jsonResult({ profile: await getGoalProfile() ?? null }),
    },
    {
      name: 'create_meal',
      label: 'Create meal',
      description: 'Create a complete meal only when explicitly asked. Supply item estimates; CalDone derives totals. Attachment IDs must come from this conversation.',
      executionMode: 'sequential',
      parameters: Type.Object({
        title: Type.String({ minLength: 1 }), mealType: mealTypeSchema,
        capturedAt: Type.Optional(Type.String({ description: 'ISO timestamp. Omit for now.' })),
        note: Type.Optional(Type.String()), items: Type.Array(itemSchema, { minItems: 1 }),
        attachmentIds: Type.Optional(Type.Array(Type.String())), statusText: activitySchema,
      }, { additionalProperties: false }),
      execute: async (callId, rawParams) => withReceipt(callId, input.threadId, async () => {
        const params = rawParams as CreateMealParams;
        const mealId = mealIdForCall(callId);
        const meal = await getMeal(mealId) ?? await createCompleteMeal(mealId, params, input.attachments);
        const action = await recordChatAction({
          id: actionIdForCall(callId), threadId: input.threadId,
          label: t('assistantCreatedMeal', { name: meal.analysis?.title ?? t('meal') }),
          undo: { kind: 'delete_meal', mealId, expectedMeal: meal },
        });
        await input.onDataChanged();
        return actionResult(action.id, action.label, mealSummary(meal));
      }),
    },
    {
      name: 'edit_meal',
      label: 'Edit meal',
      description: 'Save a first estimate or patch a meal after reading it. The original user note is read-only. Supply item nutrition yourself after inspecting evidence and researching when useful. CalDone sums totals. Resolve only answered or invalidated question IDs; unrelated questions stay open. Questions and nutrition save atomically. An answer may resolve a question without changing nutrition.',
      executionMode: 'sequential',
      parameters: Type.Object({
        mealId: Type.String(), expectedRevision: Type.Number({ minimum: 1 }),
        capturedAt: Type.Optional(Type.String({ description: 'ISO timestamp.' })),
        title: Type.Optional(Type.String({ minLength: 1 })), mealType: Type.Optional(mealTypeSchema),
        items: Type.Optional(Type.Array(itemSchema, { minItems: 1 })), addAttachmentIds: Type.Optional(Type.Array(Type.String())),
        removePhotoIds: Type.Optional(Type.Array(Type.String())),
        webImageSourceUrl: Type.Optional(Type.String({description:'Exact observed source page for optional illustrative art, only when no user photos exist.'})),
        questions: Type.Optional(Type.Array(questionSchema,{maxItems:3})),
        resolutions: Type.Optional(Type.Array(resolutionSchema)), statusText: activitySchema,
      }, { additionalProperties: false }),
      execute: async (callId, rawParams) => {
        const params = rawParams as EditMealParams;
        const cached = await getChatToolReceipt(callId, input.threadId) as Awaited<ReturnType<typeof commitMealAgentEdit>> | undefined;
        if (cached) return actionResult(cached.actionId, cached.label, mealForTool(cached.meal));
        const before = await requiredMeal(params.mealId);
        requireRevision(before, params.expectedRevision);
        requireMealEdit(params);
        const latest=input.getMessages().findLast(message=>message.role==='chatUser');
        if(latest?.role==='chatUser' && ['capture','form','addition'].includes(latest.source??'') && input.mealId && params.mealId!==input.mealId)
          throw new Error('This submitted action is for the selected meal only.');
        const research=params.items?await input.getResearch?.()??{status:'not_searched' as const,sources:[]}:undefined;
        if(research)acceptMealResearch(research,mealRequestContext(input.getMessages()).requireSearch);
        const addition=latest?.role==='chatUser' && latest.source==='addition'?latest:
          before.analysis?.dishAddition?input.getMessages().findLast(message=>message.role==='chatUser' && message.source==='addition'):undefined;
        const additionIds=addition?.role==='chatUser'?addition.attachments.map(photo=>photo.id):[];
        const addedPhotos = await copyAttachments(before.id, [...(params.addAttachmentIds ?? []),...additionIds], input.attachments);
        const webImage = await resolveMealWebImage(params.webImageSourceUrl, research, before.photos.length + addedPhotos.length > 0);
        const result = await commitMealAgentEdit({
          callId, threadId:input.threadId, mealId:before.id, expectedRevision:params.expectedRevision,
          edit:{capturedAt:parseTimestamp(params.capturedAt),note:params.note,title:params.title,mealType:params.mealType,
            items:params.items,addPhotos:addedPhotos,removePhotoIds:params.removePhotoIds},
          questions:params.questions,resolutions:params.resolutions,
          research, webImage,
          label:t('assistantUpdatedMeal',{name:params.title ?? before.analysis?.title ?? t('meal')}),
        });
        // The meal, receipt and Undo already committed. Cleanup or screen
        // refresh failures cannot truthfully make this tool report a failed edit.
        const followups = await Promise.allSettled([
          deleteUnreferencedPhotoFiles(before.photos, result.meal.photos),
          Promise.resolve().then(input.onDataChanged),
        ]);
        for (const [index, followup] of followups.entries()) if (followup.status === 'rejected') {
          await appendDiagnosticEvent({ id: `${Date.now()}-${callId}-${index}`, createdAt: Date.now(),
            operation: 'observer_error', threadId: input.threadId, toolCallId: callId,
            stage: index === 0 ? 'photo_cleanup' : 'post_commit_refresh',
          }).catch(() => undefined);
        }
        return actionResult(result.actionId, result.label, mealForTool(result.meal));
      },
    },
    {
      name: 'delete_meal',
      label: 'Delete meal',
      description: 'Delete one unambiguous meal only when explicitly asked. Read it first and provide its current revision.',
      executionMode: 'sequential',
      parameters: Type.Object({ mealId: Type.String(), expectedRevision: Type.Number({ minimum: 1 }), statusText: activitySchema }, { additionalProperties: false }),
      execute: async (callId, rawParams) => withReceipt(callId, input.threadId, async () => {
        const params = rawParams as MealMutationParams;
        const before = await requiredMeal(params.mealId);
        requireRevision(before, params.expectedRevision);
        if (!await deleteMealIfRevision(before.id, params.expectedRevision)) throw new Error('This meal changed before deletion. Read it again before retrying.');
        const action = await recordChatAction({
          id: actionIdForCall(callId), threadId: input.threadId,
          label: t('assistantDeletedMeal', { name: before.analysis?.title ?? t('meal') }),
          undo: { kind: 'restore_meal', meal: before },
        });
        await input.onDataChanged();
        return actionResult(action.id, action.label, { deletedMealId: before.id });
      }),
    },
    {
      name: 'update_goals',
      label: 'Edit goals',
      description: 'Change explicit daily calorie or macro goals only when asked. Null clears a goal; omitted fields stay unchanged.',
      executionMode: 'sequential',
      parameters: Type.Object({ calories: optionalGoal(), protein: optionalGoal(), carbs: optionalGoal(), fat: optionalGoal(), statusText: activitySchema }, { additionalProperties: false }),
      execute: async (callId, rawParams) => withReceipt(callId, input.threadId, async () => {
        const params = rawParams as UpdateGoalsParams;
        const before = await getDailyGoals();
        const next = mergeGoals(before, params);
        if (sameJson(before, next)) throw new Error('No goal values were provided to change.');
        await saveDailyGoals(next);
        const action = await recordChatAction({
          id: actionIdForCall(callId), threadId: input.threadId, label: t('assistantUpdatedGoals'),
          undo: { kind: 'restore_goals', goals: before, expectedGoals: next },
        });
        await input.onDataChanged();
        return actionResult(action.id, action.label, { goals: next });
      }),
    },
    {
      name: 'update_goal_profile',
      label: 'Edit goal profile',
      description: 'Update saved profile fields only when explicitly asked. This does not silently recalculate daily goals.',
      executionMode: 'sequential',
      parameters: Type.Object({
        age: Type.Optional(Type.Number({ minimum: 18, maximum: 100 })),
        sex: Type.Optional(Type.Union([Type.Literal('female'), Type.Literal('male')])),
        heightCm: Type.Optional(Type.Number({ minimum: 120, maximum: 230 })),
        weightKg: Type.Optional(Type.Number({ minimum: 35, maximum: 350 })),
        activity: Type.Optional(Type.Union([Type.Literal('sedentary'), Type.Literal('light'), Type.Literal('moderate'), Type.Literal('very_active')])),
        objective: Type.Optional(Type.Union([Type.Literal('lose'), Type.Literal('maintain'), Type.Literal('gain')])),
        statusText: activitySchema,
      }, { additionalProperties: false }),
      execute: async (callId, rawParams) => withReceipt(callId, input.threadId, async () => {
        const params = rawParams as UpdateGoalProfileParams;
        const before = await getGoalProfile();
        const patch = goalProfilePatch(params);
        const next = before ? mergeGoalProfile(before, patch) : parseGoalProfile(JSON.stringify(patch));
        if (!next) throw new Error('A complete valid profile is required before it can be saved.');
        if (sameJson(before, next)) throw new Error('No profile values were provided to change.');
        await saveGoalProfile(next);
        const action = await recordChatAction({
          id: actionIdForCall(callId), threadId: input.threadId, label: t('assistantUpdatedProfile'),
          undo: { kind: 'restore_goal_profile', profile: before, expectedProfile: next },
        });
        await input.onDataChanged();
        return actionResult(action.id, action.label, { profile: next, goalsChanged: false });
      }),
    },
    {
      name: 'recalculate_goals_from_profile',
      label: 'Recalculate goals',
      description: 'Recalculate and save daily goals from the saved profile only when explicitly asked.',
      executionMode: 'sequential',
      parameters: Type.Object({ statusText: activitySchema }, { additionalProperties: false }),
      execute: async (callId) => withReceipt(callId, input.threadId, async () => {
        const profile = await getGoalProfile();
        if (!profile) throw new Error('No saved goal profile is available. Ask for the missing profile values.');
        const before = await getDailyGoals();
        const next = estimateDailyGoals(profile);
        await saveDailyGoals(next);
        const action = await recordChatAction({
          id: actionIdForCall(callId), threadId: input.threadId, label: t('assistantRecalculatedGoals'),
          undo: { kind: 'restore_goals', goals: before, expectedGoals: next },
        });
        await input.onDataChanged();
        return actionResult(action.id, action.label, { goals: next });
      }),
    },
  ];
}

function optionalGoal() {
  return Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 100_000 }), Type.Null()]));
}

function mergeGoals(before: DailyGoals, patch: UpdateGoalsParams): DailyGoals {
  const next = { ...before };
  for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) {
    if (patch[key] === null) delete next[key];
    else if (patch[key] !== undefined) next[key] = patch[key];
  }
  return next;
}

function goalProfilePatch(params: UpdateGoalProfileParams): Partial<GoalProfile> {
  const patch: Partial<GoalProfile> = {};
  if (params.age !== undefined) patch.age = params.age;
  if (params.sex !== undefined) patch.sex = params.sex;
  if (params.heightCm !== undefined) patch.heightCm = params.heightCm;
  if (params.weightKg !== undefined) patch.weightKg = params.weightKg;
  if (params.activity !== undefined) patch.activity = params.activity;
  if (params.objective !== undefined) patch.objective = params.objective;
  return patch;
}

async function requiredMeal(id: string): Promise<Meal> {
  const meal = await getMeal(id);
  if (!meal) throw new Error(`Meal ${id} was not found. Search meal history again.`);
  return meal;
}

function requireRevision(meal: Meal, expectedRevision: number): void {
  if (meal.revision !== expectedRevision) throw new Error('This meal changed. Read it again before retrying.');
}

function mealSummary(meal: Meal) {
  return {
    id: meal.id, revision: meal.revision, capturedAt: new Date(meal.capturedAt).toISOString(), status: meal.status,
    title: meal.analysis?.title, mealType: meal.analysis?.mealType, totals: meal.analysis?.totals,
    research: meal.analysis?.research, note: meal.note, photoCount: meal.photos.length, clarification: meal.analysis?.clarification, questions: meal.questions, error: meal.error,
  };
}

function mealForTool(meal: Meal) {
  return {
    ...mealSummary(meal), items: meal.analysis?.items,
    photos: meal.photos.map((photo, position) => ({ id: photo.id, position, mimeType: photo.mimeType, createdAt: new Date(photo.createdAt).toISOString() })),
  };
}

async function createCompleteMeal(mealId: string, params: CreateMealParams, attachments: Map<string, ChatAttachment>): Promise<Meal> {
  const photos = await copyAttachments(mealId, params.attachmentIds ?? [], attachments);
  const meal: Meal = {
    id: mealId, revision: 1, capturedAt: parseTimestamp(params.capturedAt) ?? Date.now(), status: 'complete',
    note: params.note?.trim() ?? '', photos,
    analysis: analysisFromItems({ title: params.title, mealType: params.mealType, items: params.items }),
  };
  await saveMealRecord(meal);
  return requiredMeal(meal.id);
}

function requireMealEdit(params: EditMealParams): void {
  const fields = [params.capturedAt, params.note, params.title, params.mealType, params.items, params.addAttachmentIds, params.removePhotoIds, params.questions, params.resolutions];
  if (fields.every((value) => value === undefined)) throw new Error('No meal fields were provided to change.');
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: value };
}

function actionResult(actionId: string, label: string, value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, actionId, ...value as object }) }],
    details: { actionId, label, value },
  };
}

async function withReceipt<T>(callId: string, threadId: string, execute: () => Promise<T>): Promise<T> {
  const cached = await getChatToolReceipt(callId, threadId);
  if (cached !== undefined) return cached as T;
  const result = await execute();
  await saveChatToolReceipt(callId, threadId, result);
  return result;
}

function parseTimestamp(value?: string): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid date: ${value}`);
  return timestamp;
}

function requiredBoundary(value: string, end: boolean): number {
  const parsed = parseBoundary(value, end);
  if (parsed === undefined) throw new Error(`Invalid date: ${value}`);
  return parsed;
}

function parseBoundary(value: string | undefined, end: boolean): number | undefined {
  if (!value) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T00:00:00` : value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  if (dateOnly && end) parsed.setHours(23, 59, 59, 999);
  return parsed.getTime();
}

function parseCursor(cursor?: string): number {
  if (!cursor) return 0;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid meal search cursor.');
  return value;
}

async function copyAttachments(mealId: string, ids: string[], attachments: Map<string, ChatAttachment>): Promise<MealPhoto[]> {
  const directory = new Directory(Paths.document, 'meal-photos');
  directory.create({ idempotent: true, intermediates: true });
  return Promise.all([...new Set(ids)].map(async (id) => {
    const attachment = attachments.get(id);
    if (!attachment) throw new Error(`Attachment ${id} is unavailable.`);
    const extension = attachment.mimeType.includes('png') ? 'png' : 'jpg';
    const photoId = `${mealId}-attachment-${safeCallId(id)}`;
    const destination = new File(directory, `${photoId}.${extension}`);
    if (!destination.exists) await new File(attachment.uri).copy(destination);
    return { id: photoId, uri: destination.uri, mimeType: attachment.mimeType, createdAt: attachment.createdAt ?? Date.now() };
  }));
}

async function deleteUnreferencedPhotoFiles(candidates: MealPhoto[], retained: MealPhoto[]): Promise<void> {
  if (!candidates.some(photo => !retained.some(current => current.uri === photo.uri))) return;
  const retainedUris = await retainedInputPhotoUris();
  for (const photo of candidates) {
    if (retainedUris.has(photo.uri)) continue;
    try { new File(photo.uri).delete(); } catch { /* The database remains authoritative if cleanup fails. */ }
  }
}

function mealIdForCall(callId: string): string {
  return `assistant-${safeCallId(callId)}`;
}

function actionIdForCall(callId: string): string {
  return `assistant-action-${safeCallId(callId)}`;
}

function safeCallId(callId: string): string {
  return callId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
