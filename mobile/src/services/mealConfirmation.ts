import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Meal } from '../domain/meal';

/** Mutation confirmations describe saved values and observed research. They are
 * app-owned so a second model cannot invent a provenance story after saving. */
export function mealConfirmation(meal: Meal, language: 'ru' | 'en'): string {
  if (!meal.analysis) return '';
  const {totals,items,research} = meal.analysis;
  const ru = language === 'ru';
  const number = (value:number) => new Intl.NumberFormat(language,{maximumFractionDigits:1}).format(value);
  const quantity = items.length === 1 ? `${items[0].quantity}. ` : '';
  const estimate = ru
    ? `${quantity}Записана оценка: ${number(totals.calories)} ккал, белки ${number(totals.protein)} г, жиры ${number(totals.fat)} г, углеводы ${number(totals.carbs)} г.`
    : `${quantity}Recorded estimate: ${number(totals.calories)} kcal, ${number(totals.protein)} g protein, ${number(totals.fat)} g fat, ${number(totals.carbs)} g carbs.`;
  const status = research?.status ?? 'not_searched';
  const explanations = {
    not_searched: ru ? 'Веб-поиск не выполнялся.' : 'The web was not searched.',
    completed: ru ? 'Веб-поиск выполнен. Значения остаются оценочными.' : 'Web search completed. Values remain estimates.',
    unavailable: ru ? 'Веб-поиск недоступен.' : 'Web search is unavailable.',
    failed: ru ? 'Веб-поиск не удалось завершить.' : 'Web search could not be completed.',
    unobserved: ru ? 'Не удалось проверить выполнение веб-поиска.' : 'Web search execution could not be verified.',
  };
  const links = (research?.sources ?? []).flatMap(source => {
    try {
      const url = new URL(source.url);
      if (!['http:','https:'].includes(url.protocol)) return [];
      return [`[${url.hostname}](${url.href.replaceAll('(', '%28').replaceAll(')', '%29')})`];
    } catch { return []; }
  });
  return `${meal.analysis.title}: ${estimate}\n\n${explanations[status]}${links.length ? `\n${ru ? 'Источники поиска' : 'Search sources'}: ${links.join(', ')}` : ''}`;
}

export function confirmationForTurn(messages: AgentMessage[]): string | undefined {
  const lastUser = messages.findLastIndex(message => message.role === 'chatUser' || message.role === 'user');
  const confirmations = messages.slice(lastUser + 1).flatMap(message => {
    if (message.role !== 'toolResult' || message.isError || !['answer_meal_question','reanalyze_meal'].includes(message.toolName)) return [];
    const details = message.details as {value?:{confirmation?:unknown}} | undefined;
    return typeof details?.value?.confirmation === 'string' ? [details.value.confirmation] : [];
  });
  return confirmations.length ? confirmations.join('\n\n') : undefined;
}
