import { describe, it, expect } from 'vitest';
import { parseLogChunk } from '../composeLogParser';

describe('parseLogChunk', () => {
  it('detects PULL stage', () => {
    const [row] = parseLogChunk('[+] Pulling fs layer', 0);
    expect(row.stage).toBe('PULL');
    expect(row.level).toBe('info');
  });

  it('detects BUILD stage', () => {
    const [row] = parseLogChunk('[+] Building 0.0s (3/7)', 0);
    expect(row.stage).toBe('BUILD');
    expect(row.level).toBe('info');
  });

  it('detects CREATE stage', () => {
    const [row] = parseLogChunk('[+] Creating myapp-web-1', 0);
    expect(row.stage).toBe('CREATE');
    expect(row.level).toBe('info');
  });

  it('detects START stage', () => {
    const [row] = parseLogChunk('[+] Starting myapp-web-1', 0);
    expect(row.stage).toBe('START');
    expect(row.level).toBe('info');
  });

  it('detects STOP stage', () => {
    const [row] = parseLogChunk('[+] Stopping myapp-web-1', 0);
    expect(row.stage).toBe('STOP');
    expect(row.level).toBe('info');
  });

  it('detects DOWN stage', () => {
    const [row] = parseLogChunk('[+] Removing myapp-web-1', 0);
    expect(row.stage).toBe('DOWN');
    expect(row.level).toBe('info');
  });

  it('detects WARN stage', () => {
    const [row] = parseLogChunk('WARN[0000] some warning message', 0);
    expect(row.stage).toBe('WARN');
    expect(row.level).toBe('warn');
  });

  it('detects ERR stage', () => {
    const [row] = parseLogChunk('Error response from daemon: No such container', 0);
    expect(row.stage).toBe('ERR');
    expect(row.level).toBe('error');
  });

  it('falls through to LOG for unrecognized lines', () => {
    const [row] = parseLogChunk('Step 3/7 : RUN npm install', 0);
    expect(row.stage).toBe('LOG');
    expect(row.level).toBe('info');
  });

  it('strips ANSI escapes from message but keeps raw intact', () => {
    const input = '\x1b[32m[+] Starting myapp\x1b[0m';
    const [row] = parseLogChunk(input, 0);
    expect(row.stage).toBe('START');
    expect(row.message).not.toContain('\x1b');
    expect(row.raw).toBe(input.trim());
    expect(row.raw).toContain('\x1b');
  });

  it('returns 3 rows for a 3-line chunk', () => {
    const rows = parseLogChunk('line1\nline2\nline3', 0);
    expect(rows).toHaveLength(3);
  });

  it('skips empty lines', () => {
    const rows = parseLogChunk('line1\n\n\nline2', 0);
    expect(rows).toHaveLength(2);
  });

  it('applies idOffset to row ids', () => {
    const [row] = parseLogChunk('line', 5);
    expect(row.id).toBe('row-5');
  });

  it('handles CRLF line endings', () => {
    const rows = parseLogChunk('line1\r\nline2', 0);
    expect(rows).toHaveLength(2);
  });

  it('produces non-colliding IDs across two calls when caller advances offset', () => {
    const first = parseLogChunk('line-a\nline-b', 0);
    expect(first).toHaveLength(2);
    expect(first[0].id).toBe('row-0');
    expect(first[1].id).toBe('row-1');

    const second = parseLogChunk('line-c', first.length);
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('row-2');
  });
});
