import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { normalizeQuestionChoices } from '../domain/questionChoices.ts';

/** Returns immediately; the next user message supplies the answer. No data mutation. */
export const questionTool: AgentTool = {
  name: 'ask_question',
  label: 'Ask a question',
  description: 'Display one to three questions with selectable answers. Use whenever a question has useful suggested answers, including confirmations, meal selection, preferences, counts and approximate portions. End your turn after this tool; wait for the user before acting. The app supplies Not sure and a custom-answer field.',
  parameters: Type.Object({
    questions: Type.Array(Type.Object({
      question: Type.String({ minLength: 1, maxLength: 500 }),
      options: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { minItems: 2, maxItems: 6 }),
    }, { additionalProperties: false }), { minItems: 1, maxItems: 3 }),
    statusText: Type.Optional(Type.String({ maxLength: 80 })),
  }, { additionalProperties: false }),
  execute: async (_id, params) => {
    const questions = normalizeQuestionChoices((params as { questions?: unknown }).questions);
    if (!questions.length) throw new Error('Provide questions with at least two distinct, non-empty answers.');
    const details = { questions };
    return {
      content: [{ type: 'text', text: JSON.stringify({ ...details, instruction: 'Questions displayed. End this turn and wait for the user. No answer has been given and no change is authorized by this result.' }) }],
      details,
    };
  },
};
