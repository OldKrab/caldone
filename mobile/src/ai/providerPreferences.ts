/** A fresh provider can search by default; an explicit user choice always wins. */
export function webSearchPreference(stored: string | null): boolean {
  return stored === null ? true : stored === 'true';
}
