/** Suggested answers are model proposals, never user evidence until submitted. */
export type QuestionChoices = { question: string; options: string[] };

/** Validate untrusted model output and old saved tool results before rendering controls. */
export function normalizeQuestionChoices(value: unknown): QuestionChoices[] {
  if (!Array.isArray(value)) return [];
  const result: QuestionChoices[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || typeof entry.question !== 'string') continue;
    const question = entry.question.trim();
    if (!question || question.length > 500 || result.some(item => item.question === question)) continue;
    const options = Array.isArray(entry.options)
      ? [...new Set<string>(entry.options.filter((option: unknown): option is string => typeof option === 'string')
        .map((option: string) => option.trim()).filter((option: string) => option.length > 0 && option.length <= 160))].slice(0, 6)
      : [];
    if (options.length >= 2) result.push({ question, options });
    if (result.length === 3) break;
  }
  return result;
}

/** Include the question so repeated answers such as “Yes” retain their meaning. */
export function formatQuestionAnswers(questions: QuestionChoices[], answers: Record<string, string>): string {
  return questions.flatMap(({ question }) => {
    const answer = typeof answers[question] === 'string' ? answers[question].trim() : '';
    return answer ? [`${question}\n${answer}`] : [];
  }).join('\n\n');
}
