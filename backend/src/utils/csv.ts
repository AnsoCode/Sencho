/**
 * Escape a single field for RFC 4180 CSV output. Wraps the value in quotes
 * and doubles embedded quotes when the field contains a comma, quote, or
 * newline. Null / undefined become the empty string.
 */
export function escapeCsvField(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
