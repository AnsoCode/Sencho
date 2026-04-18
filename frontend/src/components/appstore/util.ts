export function firstSentence(text?: string): string | undefined {
  if (!text) return undefined;
  return text.split(/[.!?]/)[0]?.trim() || undefined;
}
