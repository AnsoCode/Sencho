import cronstrue from 'cronstrue';

export function getCronDescription(expression: string): string {
  try {
    return cronstrue.toString(expression);
  } catch {
    return 'Invalid expression';
  }
}

export function formatTimestamp(ts: number | null): string {
  if (ts == null) return '-';
  return new Date(ts).toLocaleString();
}
