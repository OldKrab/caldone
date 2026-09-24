/** Execution metadata is supplied by the transport, never by model-authored JSON. */
export type MealResearch = {
  status: 'not_searched' | 'completed' | 'failed' | 'unavailable' | 'unobserved';
  sources: Array<{url: string; title: string}>;
  responseId?: string;
};

/** Recognize direct search requests in the app's supported languages. The model
 * can additionally request research for indirect wording; it cannot disable this guard. */
export function explicitlyRequestsSearch(text: string): boolean {
  const clauses = text.toLowerCase().split(/[.!?;\n]+/);
  return clauses.some(clause => {
    if (/\b(?:do not|don't|without|no need to)\s+(?:web\s+)?(?:search|google|browse)\b|(?:не\s+(?:надо\s+|нужно\s+)?|без\s+)(?:гугл|гугли|ищи|искать|поиск)/u.test(clause)) return false;
    return /\b(?:google(?:\s+it)?|search\s+(?:the\s+)?(?:web|online|for)|look\s+(?:it\s+)?up|browse\s+(?:the\s+)?web)\b|(?:по|за)?гугл[а-яё]*|(?:найди|поищи|ищи|проверь)\s+.{0,80}(?:интернет|онлайн|сайт|сети)|веб[ -]?поиск/u.test(clause);
  });
}
