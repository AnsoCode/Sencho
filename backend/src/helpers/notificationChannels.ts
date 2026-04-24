export const NOTIFICATION_CHANNEL_TYPES = ['discord', 'slack', 'webhook'] as const;
export type NotificationChannelType = typeof NOTIFICATION_CHANNEL_TYPES[number];

export const cleanStackPatterns = (patterns: string[]): string[] =>
  [...new Set(patterns.map(p => p.trim()).filter(Boolean))];

export function validateHttpsUrl(value: unknown): string | null {
  if (!value || typeof value !== 'string' || !value.startsWith('https://')) return 'must be a valid HTTPS URL';
  try { new URL(value); } catch { return 'is not a valid URL'; }
  return null;
}
