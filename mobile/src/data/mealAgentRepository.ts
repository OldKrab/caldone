import { transaction } from './database';
import { getMeal, readMeal, writeMealIfRevision } from './mealRepository';
import { changeAgentQuestions } from './agentQuestionRepository';
import { applyMealEdit, analysisFromItems, type MealEdit } from '../domain/mealOperations';
import type { AgentQuestion, QuestionResolution } from '../domain/agentQuestion';
import type { QuestionChoices } from '../domain/questionChoices';
import type { Meal } from '../domain/meal';
import type { MealResearch } from '../domain/mealResearch';

export async function getMealAgentQuestions(mealId: string, _threadId?: string): Promise<AgentQuestion[]> {
  return (await getMeal(mealId))?.questions ?? [];
}

type MealCommit = { meal: Meal; actionId: string; label: string };

/** Nutrition, question transitions, Undo and the retry receipt commit atomically.
 * A crash after COMMIT can replay the call without applying its changes twice. */
export async function commitMealAgentEdit(input: {
  callId: string;
  threadId: string;
  mealId: string;
  expectedRevision: number;
  edit: MealEdit;
  questions?: QuestionChoices[];
  resolutions?: QuestionResolution[];
  research?: MealResearch;
  webImage?: import('../domain/mealWebImage').MealWebImage;
  label?: string;
}): Promise<MealCommit> {
  return transaction(async (connection) => {
    if (!(await connection.getFirstAsync('SELECT id FROM chat_threads WHERE id = ?', input.threadId)))
      throw new Error('Conversation no longer exists.');
    const receipt = await connection.getFirstAsync<{ result_json: string }>(
      'SELECT result_json FROM chat_tool_receipts WHERE call_id = ? AND thread_id = ?',
      input.callId,
      input.threadId,
    );
    if (receipt) return JSON.parse(receipt.result_json) as MealCommit;
    const before = await readMeal(connection, input.mealId);
    if (!before) throw new Error('Meal no longer exists.');
    if (before.revision !== input.expectedRevision)
      throw new Error('This meal changed. Read it again before retrying.');
    // This field is the user's original input, displayed as "Your note".
    // Model explanations belong to aiComment or the conversation, not here.
    if (input.edit.note !== undefined && input.edit.note !== before.note)
      throw new Error('The original user note is read-only. Use aiComment for explanations and assumptions.');
    if (input.edit.aiComment !== undefined &&
        (typeof input.edit.aiComment !== 'string' || input.edit.aiComment.length > 4_000))
      throw new Error('AI comments must be text of at most 4000 characters.');
    if (
      input.edit.items !== undefined &&
      (!input.edit.items.length ||
        input.edit.items.some(
          (item) =>
            !item.name?.trim() ||
            !item.quantity?.trim() ||
            ['calories', 'protein', 'carbs', 'fat'].some((key) => {
              const value = item[key as 'calories'];
              return !Number.isFinite(value) || value < 0 || value > (key === 'calories' ? 100_000 : 10_000);
            }),
        ))
    )
      throw new Error('Nutrition items need names, quantities and finite non-negative nutrition values.');
    const competing = await connection.getFirstAsync<{ id: string }>(
      `SELECT id FROM agent_turns
      WHERE meal_id=? AND thread_id<>? AND state IN ('queued','running') LIMIT 1`,
      before.id,
      input.threadId,
    );
    if (competing)
      throw new Error('Another request is working on this meal. Wait for it before changing the record.');
    const turn = await connection.getFirstAsync<{ message_json: string }>(
      "SELECT message_json FROM agent_turns WHERE thread_id=? AND state='running' ORDER BY created_at DESC LIMIT 1",
      input.threadId,
    );
    const message = turn
      ? (JSON.parse(turn.message_json) as import('../domain/chat').ChatUserMessage)
      : undefined;
    const addition = message?.source === 'addition';
    const originalCount = addition
      ? (message.additionOriginalItemCount ?? before.analysis?.items.length ?? 0)
      : (before.analysis?.dishAddition?.originalItemCount ?? 0);
    if (addition || before.analysis?.dishAddition) {
      if (
        (input.edit.capturedAt !== undefined && input.edit.capturedAt !== before.capturedAt) ||
        (input.edit.mealType !== undefined && input.edit.mealType !== before.analysis?.mealType) ||
        (input.edit.title !== undefined && input.edit.title !== before.analysis?.title) ||
        (input.edit.note !== undefined && input.edit.note !== before.note) ||
        input.edit.removePhotoIds?.length
      )
        throw new Error('An addition must preserve the original meal title, time, type, note and photos.');
      if (addition && input.edit.items && input.edit.items.length <= originalCount)
        throw new Error('An addition must include at least one new food item.');
    }
    if (input.edit.items && originalCount) {
      const fields = ['name', 'quantity', 'calories', 'protein', 'carbs', 'fat'] as const;
      if (
        before
          .analysis!.items.slice(0, originalCount)
          .some((item, index) => fields.some((field) => item[field] !== input.edit.items![index]?.[field]))
      )
        throw new Error(
          'An addition must preserve every original item and its values. Change only the added dish.',
        );
    }
    let draft = applyMealEdit(before, input.edit);
    if (!before.analysis && input.edit.items) {
      if (!input.edit.title || !input.edit.mealType)
        throw new Error('The first estimate needs a title, meal type and items.');
      draft.analysis = analysisFromItems({
        title: input.edit.title,
        mealType: input.edit.mealType,
        items: input.edit.items,
      });
    }
    if (draft.analysis && input.edit.items && input.research) draft.analysis.research = input.research;
    // Artwork identifies the food, not its portion. Keep it for quantity-only
    // answers, but never show the previous food's picture after reidentification.
    if (draft.analysis && input.edit.items && before.analysis &&
        JSON.stringify(input.edit.items.map(item => item.name)) !== JSON.stringify(before.analysis.items.map(item => item.name)))
      delete draft.analysis.webImage;
    if (draft.analysis && input.webImage) draft.analysis.webImage = input.webImage;
    const questions = (await changeAgentQuestions(input, connection)).filter(
      (question) => question.mealId === before.id,
    );
    const open = questions.filter((question) => question.state === 'open');
    draft = {
      ...draft,
      questions,
      status: open.length || !draft.analysis
        ? 'needs_input'
        : questions.some((question) => question.state === 'answered' && question.uncertain)
          ? 'estimated'
          : 'complete',
      error: undefined,
    };
    if (draft.analysis)
      draft.analysis.clarification = open.length
        ? {
            questions: open.map((question) => question.question),
            choices: open,
            impactCalories: before.analysis?.clarification?.impactCalories ?? 0,
          }
        : undefined;
    if (draft.analysis) {
      if (addition && open.length)
        draft.analysis.dishAddition = {
          originalItemCount: originalCount,
          photoIds: [
            ...new Set([
              ...(before.analysis?.dishAddition?.photoIds ?? []),
              ...draft.photos
                .filter((photo) => !before.photos.some((old) => old.id === photo.id))
                .map((photo) => photo.id),
            ]),
          ],
          note: message!.text,
        };
      else if (!open.length) delete draft.analysis.dishAddition;
    }
    const meal = await writeMealIfRevision(connection, draft, before.revision);
    if (!meal) throw new Error('This meal changed. Read it again before retrying.');
    const actionId = `agent:${input.callId}`;
    const label = input.label ?? `Updated ${meal.analysis?.title ?? 'meal'}`;
    const result: MealCommit = { meal, actionId, label };
    await connection.runAsync(
      'INSERT INTO chat_actions (id,thread_id,label,created_at,undone,undo_json) VALUES (?,?,?,?,0,?)',
      actionId,
      input.threadId,
      label,
      Date.now(),
      JSON.stringify({ kind: 'restore_meal', meal: before, expectedMeal: meal }),
    );
    await connection.runAsync(
      'INSERT INTO chat_tool_receipts (call_id,thread_id,result_json) VALUES (?,?,?)',
      input.callId,
      input.threadId,
      JSON.stringify(result),
    );
    return result;
  });
}
