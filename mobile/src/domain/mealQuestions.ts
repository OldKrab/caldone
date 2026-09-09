import { normalizeQuestionChoices, type QuestionChoices } from './questionChoices.ts';

export type MealClarification = {
  questions: string[];
  /** Optional additive field: legacy questions remain readable without choices. */
  choices?: QuestionChoices[];
  impactCalories: number;
};

export type LegacyMealClarification = {
  question: string;
  impactCalories: number;
};

export function mealQuestions(clarification?: MealClarification | LegacyMealClarification): string[] {
  if (!clarification) return [];
  const questions = 'questions' in clarification ? clarification.questions : [clarification.question];
  return questions.map((question) => question.trim()).filter(Boolean);
}

export function normalizeClarification(value: unknown): MealClarification | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as { questions?: unknown; question?: unknown; choices?: unknown; impactCalories?: unknown };
  const rawQuestions = Array.isArray(source.questions)
    ? source.questions
    : typeof source.question === 'string' ? [source.question] : [];
  const questions = rawQuestions
    .filter((question): question is string => typeof question === 'string')
    .map((question) => question.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (questions.length === 0 || typeof source.impactCalories !== 'number' || !Number.isFinite(source.impactCalories) || source.impactCalories < 0) {
    return undefined;
  }
  const choices = normalizeQuestionChoices(source.choices).filter(choice => questions.includes(choice.question));
  return { questions, impactCalories: source.impactCalories, ...(choices.length ? { choices } : {}) };
}

export function mealQuestionChoices(clarification?: MealClarification | LegacyMealClarification): QuestionChoices[] {
  const choices = normalizeQuestionChoices(clarification && 'choices' in clarification ? clarification.choices : undefined);
  return mealQuestions(clarification).map(question => ({
    question,
    options: choices.find(choice => choice.question === question)?.options ?? [],
  }));
}
