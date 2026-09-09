const markdownSyntax = /[*_`#[\]<>]/;

/** Returns display-only model copy when it is short, single-line plain text. */
export function userFacingToolActivity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 80 || /[\r\n]/.test(text) || markdownSyntax.test(text)) return undefined;
  return text;
}
