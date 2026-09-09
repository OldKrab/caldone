export type MealClarificationInput = {
  previousJson: string;
  question: string;
  answer: string;
  assistantInterpretation?: string;
  note?: string;
  photos: readonly { base64: string; mimeType: string }[];
};

/** Provider-visible context for a follow-up to a saved meal. */
export function buildMealClarificationContent(
  input: MealClarificationInput,
): Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> {
  return [
    {
      type: 'text',
      text: JSON.stringify({existingMeal: input.previousJson, savedNote: input.note ?? '', question: input.question, userAnswer: input.answer, assistantInterpretation: input.assistantInterpretation}),
    },
    ...input.photos.map((photo) => ({
      type: 'image' as const,
      data: photo.base64,
      mimeType: photo.mimeType,
    })),
  ];
}
