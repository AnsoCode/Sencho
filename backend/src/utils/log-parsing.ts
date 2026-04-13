/**
 * Shared utilities for global log parsing.
 *
 * Both the polling snapshot (`GET /api/logs/global`) and the SSE stream
 * (`GET /api/logs/global/stream`) need identical timestamp extraction,
 * log-level classification, and container-name normalization. Extracting
 * them here eliminates duplication and provides a single place to test.
 */

export interface GlobalLogEntry {
  stackName: string;
  containerName: string;
  source: 'STDOUT' | 'STDERR';
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  timestampMs: number;
}

// Matches ISO 8601 timestamps with Z or +/-HH:MM offset.
// Docker's `timestamps: true` typically emits Z, but some logging drivers
// and Docker configurations produce offset notation instead.
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+(.*)/;

// Non-printable control characters that appear in TTY container logs.
// Stripping them prevents garbled output in the UI and JSON responses.
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

// --- Level detection regexes (compiled once) ---

// Tier 1: Explicit INFO/DEBUG/TRACE indicators override the STDERR default.
const INFO_STRUCTURED_RE = /level=["']?(info|debug|trace)["']?/i;
const INFO_BRACKET_RE = /\[\s*(info|inf|debug|dbg|trace)\s*\]/i;
const INFO_KEYWORD_RE = /(?:\s|^)(info|inf|debug|trace)(?:\s|:|\(|\[|$)/i;

// Tier 2: WARN indicators.
const WARN_STRUCTURED_RE = /level=["']?(warn|warning)["']?/i;
const WARN_BRACKET_RE = /\[\s*(warn|warning)\s*\]/i;
const WARN_KEYWORD_RE = /(?:\s|^)(warn|warning)(?:\s|:|\(|\[|$)/i;

// Tier 3: ERROR indicators.
const ERROR_STRUCTURED_RE = /level=["']?(error|err|fatal|crit|critical|panic)["']?/i;
const ERROR_BRACKET_RE = /\[\s*(error|err|fatal|crit|critical|panic)\s*\]/i;
const ERROR_KEYWORD_RE = /(?:\s|^)(error|err|fatal|crit|critical|panic)(?:\s|:|\(|\[|$)/i;
const EXCEPTION_RE = /Exception:/i;

/**
 * Strip the Docker Compose stack prefix and trailing replica suffix from a
 * container name so the UI shows the clean service name.
 *
 * Examples:
 *   normalizeContainerName('mystack-redis-1', 'mystack')  -> 'redis'
 *   normalizeContainerName('mystack_redis_1', 'mystack')  -> 'redis'
 *   normalizeContainerName('standalone',      'system')   -> 'standalone'
 */
export function normalizeContainerName(rawName: string, stackName: string): string {
  if (rawName.startsWith(`${stackName}-`)) {
    return rawName.slice(stackName.length + 1).replace(/-1$/, '');
  }
  if (rawName.startsWith(`${stackName}_`)) {
    return rawName.slice(stackName.length + 1).replace(/_1$/, '');
  }
  return rawName;
}

/**
 * Extract and parse an ISO timestamp from the beginning of a Docker log line.
 * Returns the millisecond epoch value and the remainder of the line (the actual
 * log message). Falls back to `Date.now()` when no timestamp is found.
 */
export function parseLogTimestamp(line: string): { timestampMs: number; cleanMessage: string } {
  const match = line.match(TIMESTAMP_RE);
  if (match) {
    return {
      timestampMs: new Date(match[1]).getTime(),
      cleanMessage: match[2],
    };
  }
  return { timestampMs: Date.now(), cleanMessage: line };
}

/**
 * Three-tier regex classification to detect the log level from a message.
 *
 * Priority order:
 *   1. Explicit INFO/DEBUG/TRACE keywords (overrides the STDERR default)
 *   2. WARN keywords
 *   3. ERROR/FATAL/CRIT/PANIC keywords or `Exception:` pattern
 *   4. Fallback: STDERR -> ERROR, STDOUT -> INFO
 */
export function detectLogLevel(message: string, source: 'STDOUT' | 'STDERR'): 'INFO' | 'WARN' | 'ERROR' {
  // Tier 1: INFO/DEBUG/TRACE (overrides STDERR default)
  if (INFO_STRUCTURED_RE.test(message) || INFO_BRACKET_RE.test(message) || INFO_KEYWORD_RE.test(message)) {
    return 'INFO';
  }
  // Tier 2: WARN
  if (WARN_STRUCTURED_RE.test(message) || WARN_BRACKET_RE.test(message) || WARN_KEYWORD_RE.test(message)) {
    return 'WARN';
  }
  // Tier 3: ERROR
  if (ERROR_STRUCTURED_RE.test(message) || ERROR_BRACKET_RE.test(message) || ERROR_KEYWORD_RE.test(message) || EXCEPTION_RE.test(message)) {
    return 'ERROR';
  }
  // Tier 4: Fallback based on stream source
  return source === 'STDERR' ? 'ERROR' : 'INFO';
}

/** Strip non-printable control characters from TTY container log output. */
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHARS_RE, '');
}

/**
 * Parse Docker's multiplexed log stream format and call `onLine` for each
 * line. TTY containers produce raw text (no headers); non-TTY containers
 * prepend an 8-byte header per frame:
 *   [streamType(1), reserved(3), payloadLength(4 BE)]
 */
export function demuxDockerLog(
  buf: Buffer,
  isTty: boolean,
  onLine: (line: string, source: 'STDOUT' | 'STDERR') => void,
): void {
  if (isTty) {
    stripControlChars(buf.toString('utf-8'))
      .split('\n')
      .forEach(line => onLine(line, 'STDOUT'));
    return;
  }
  let offset = 0;
  while (offset < buf.length) {
    if (offset + 8 > buf.length) break;
    const streamType = buf[offset];
    const length = buf.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + length > buf.length) break;
    const payload = buf.slice(offset, offset + length).toString('utf-8');
    offset += length;
    payload.split('\n').forEach(line => onLine(line, streamType === 2 ? 'STDERR' : 'STDOUT'));
  }
}
