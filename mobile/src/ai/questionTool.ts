import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { getMeal } from '../data/mealRepository';
import { commitMealAgentEdit } from '../data/mealAgentRepository';
import { transaction } from '../data/database';
import { changeAgentQuestions, readAgentQuestions } from '../data/agentQuestionRepository';
import type { AgentQuestion, QuestionResolution } from '../domain/agentQuestion';
import type { QuestionChoices } from '../domain/questionChoices';

export const questionSchema = Type.Object(
  {
    question: Type.String({ minLength: 1, maxLength: 500 }),
    options: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 6 }),
  },
  { additionalProperties: false },
);
export const resolutionSchema = Type.Object(
  {
    id: Type.String(),
    state: Type.Union([Type.Literal('answered'), Type.Literal('dismissed')]),
    answer: Type.String({
      minLength: 1,
      description: 'Actual user answer, or why the question no longer applies.',
    }),
    uncertain: Type.Optional(
      Type.Boolean({ description: 'True for an unknown or uncertain answer; never invent certainty.' }),
    ),
  },
  { additionalProperties: false },
);
const statusText = Type.Optional(Type.String({ maxLength: 80 }));

/** Questions are saved operations, not a model request waiting for a human.
 * Meal questions resolve with the meal edit; conversational questions use the
 * same records but do not require a nutrition mutation. */
export function createQuestionTools(input: {
  threadId: string;
  mealId?: string;
  onDataChanged: () => Promise<void>;
}): AgentTool[] {
  return [
    {
      name: 'ask_question',
      label: 'Ask a question',
      description:
        'Save and display one to three questions. Supply useful choices or an empty options array for free text. The app adds Not sure. End your turn and wait for a real user answer; suggested choices are not facts.',
      parameters: Type.Object(
        {
          mealId: Type.Optional(
            Type.String({ description: 'The meal this question concerns. Defaults to the selected meal.' }),
          ),
          questions: Type.Array(questionSchema, { minItems: 1, maxItems: 3 }),
          statusText,
        },
        { additionalProperties: false },
      ),
      execute: async (callId, raw) => {
        const params = raw as { mealId?: string; questions: QuestionChoices[] };
        const mealId = params.mealId ?? input.mealId;
        let questions: AgentQuestion[];
        if (mealId) {
          const meal = await getMeal(mealId);
          if (!meal) throw new Error('Meal no longer exists.');
          const result = await commitMealAgentEdit({
            callId,
            threadId: input.threadId,
            mealId,
            expectedRevision: meal.revision,
            edit: {},
            questions: params.questions,
          });
          questions = result.meal.questions ?? [];
        } else
          questions = await commitConversationQuestions(callId, input.threadId, {
            questions: params.questions,
          });
        await input.onDataChanged();
        return questionResult(
          questions,
          'Questions saved and displayed. End this turn and wait for the user; no answer has been supplied yet.',
        );
      },
    },
    {
      name: 'get_questions',
      label: 'Read questions',
      description:
        'Read current question IDs and their explicit states. Includes questions for the selected meal and this conversation.',
      parameters: Type.Object({ statusText }, { additionalProperties: false }),
      execute: async () => questionResult(await readAgentQuestions(input)),
    },
    {
      name: 'resolve_questions',
      label: 'Resolve conversation questions',
      description:
        'Record answers or dismiss invalid questions in this general conversation. For meal questions use edit_meal.resolutions so answers and nutrition save together.',
      parameters: Type.Object(
        { resolutions: Type.Array(resolutionSchema, { minItems: 1 }), statusText },
        { additionalProperties: false },
      ),
      execute: async (callId, raw) => {
        const questions = await commitConversationQuestions(
          callId,
          input.threadId,
          raw as { resolutions: QuestionResolution[] },
        );
        await input.onDataChanged();
        return questionResult(questions);
      },
    },
  ];
}

function questionResult(questions: AgentQuestion[], instruction?: string) {
  const details = { questions };
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ ...details, ...(instruction ? { instruction } : {}) }),
      },
    ],
    details,
  };
}

async function commitConversationQuestions(
  callId: string,
  threadId: string,
  changes: { questions?: QuestionChoices[]; resolutions?: QuestionResolution[] },
): Promise<AgentQuestion[]> {
  return transaction(async (connection) => {
    const existing = await connection.getFirstAsync<{ result_json: string }>(
      'SELECT result_json FROM chat_tool_receipts WHERE call_id=? AND thread_id=?',
      callId,
      threadId,
    );
    if (existing) return JSON.parse(existing.result_json).details.questions;
    const questions = await changeAgentQuestions({ callId, threadId, ...changes }, connection);
    await connection.runAsync(
      'INSERT INTO chat_tool_receipts (call_id,thread_id,result_json) VALUES (?,?,?)',
      callId,
      threadId,
      JSON.stringify(questionResult(questions)),
    );
    return questions;
  });
}
