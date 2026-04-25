export type LogStage = 'PULL' | 'BUILD' | 'CREATE' | 'START' | 'STOP' | 'DOWN' | 'WARN' | 'ERR' | 'LOG';
export type LogLevel = 'info' | 'warn' | 'error';

export interface ParsedLogRow {
  id: string;
  timestamp: string;
  stage: LogStage;
  level: LogLevel;
  message: string;
  raw: string;
}

// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_CSI, '').replace(ANSI_OSC, '');
}

function classify(line: string): { stage: LogStage; level: LogLevel } {
  if (line.includes('[+] Pulling') || line.includes('Pulling from')) {
    return { stage: 'PULL', level: 'info' };
  }
  if (line.includes('[+] Building')) {
    return { stage: 'BUILD', level: 'info' };
  }
  if (line.includes('[+] Creating')) {
    return { stage: 'CREATE', level: 'info' };
  }
  if (line.includes('[+] Starting')) {
    return { stage: 'START', level: 'info' };
  }
  if (line.includes('[+] Stopping') || line.includes('[+] Stopped')) {
    return { stage: 'STOP', level: 'info' };
  }
  if (line.includes('[+] Removing') || line.includes('[+] Removed')) {
    return { stage: 'DOWN', level: 'info' };
  }
  if (line.startsWith('WARN[')) {
    return { stage: 'WARN', level: 'warn' };
  }
  if (
    line.includes('Error response from daemon') ||
    /^error/i.test(line)
  ) {
    return { stage: 'ERR', level: 'error' };
  }
  return { stage: 'LOG', level: 'info' };
}

export function parseLogChunk(chunk: string, idOffset: number): ParsedLogRow[] {
  const timestamp = new Date().toISOString();
  const rows: ParsedLogRow[] = [];

  const lines = chunk.split(/\r?\n/);
  let index = 0;

  for (const line of lines) {
    const raw = line.trim();
    if (raw === '') continue;

    const message = stripAnsi(raw);
    const { stage, level } = classify(message);

    rows.push({
      id: `row-${idOffset + index}`,
      timestamp,
      stage,
      level,
      message,
      raw,
    });

    index++;
  }

  return rows;
}
