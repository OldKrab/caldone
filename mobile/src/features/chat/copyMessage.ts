/** Only displayed message text may leave the conversation via Copy. */
export type CopyableMessage = {
  role: string;
  text?: string;
  content?: readonly unknown[];
  questions?: readonly string[];
};

export function messageCopyText(message: CopyableMessage): string {
  if (message.role === 'chatUser') return message.text ?? '';
  if (message.role === 'mealQuestion') return message.questions?.join('\n\n') ?? '';
  if (message.role !== 'assistant') return '';
  return (message.content ?? [])
    .flatMap((block) => {
      if (typeof block !== 'object' || block === null) return [];
      if (
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string' &&
        block.text.trim()
      )
        return [block.text];
      return [];
    })
    .join('\n\n');
}

/** Await the OS write before reporting success; failures remain visible to the caller. */
export async function copyMessage(
  message: CopyableMessage,
  writeText: (text: string) => Promise<unknown>,
): Promise<boolean> {
  const text = messageCopyText(message);
  if (!text.trim()) return false;
  await writeText(text);
  return true;
}
