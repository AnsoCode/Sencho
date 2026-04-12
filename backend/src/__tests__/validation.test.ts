import { describe, it, expect } from 'vitest';
import { isValidStackName, isValidRemoteUrl, isPathWithinBase } from '../utils/validation';

// ─── isValidStackName ────────────────────────────────────────────────────────

describe('isValidStackName', () => {
  it('accepts alphanumeric names', () => {
    expect(isValidStackName('mystack')).toBe(true);
    expect(isValidStackName('MyStack123')).toBe(true);
  });

  it('accepts hyphens and underscores', () => {
    expect(isValidStackName('my-stack')).toBe(true);
    expect(isValidStackName('my_stack')).toBe(true);
  });

  it('rejects path separators', () => {
    expect(isValidStackName('../etc')).toBe(false);
    expect(isValidStackName('foo/bar')).toBe(false);
    expect(isValidStackName('foo\\bar')).toBe(false);
  });

  it('rejects dots', () => {
    expect(isValidStackName('.hidden')).toBe(false);
    expect(isValidStackName('foo.bar')).toBe(false);
  });

  it('rejects spaces and special characters', () => {
    expect(isValidStackName('my stack')).toBe(false);
    expect(isValidStackName('foo;rm -rf /')).toBe(false);
    expect(isValidStackName('')).toBe(false);
  });

  it('rejects URL-encoded traversal attempts', () => {
    // These would already be decoded by decodeURIComponent before validation,
    // but the raw encoded forms should also fail
    expect(isValidStackName('%2e%2e%2f')).toBe(false);
    expect(isValidStackName('foo%2fbar')).toBe(false);
    expect(isValidStackName('..%2fetc')).toBe(false);
  });

  it('rejects unicode characters', () => {
    expect(isValidStackName('stäck')).toBe(false);
    expect(isValidStackName('stack\u0000')).toBe(false);
    expect(isValidStackName('\u202Estack')).toBe(false);
  });

  it('handles very long names', () => {
    // The regex itself has no length limit, but 255 chars should still pass
    const longValid = 'a'.repeat(255);
    expect(isValidStackName(longValid)).toBe(true);

    // Names with only valid chars remain valid regardless of length
    const veryLong = 'stack-' + 'x'.repeat(1000);
    expect(isValidStackName(veryLong)).toBe(true);
  });
});

// ─── isValidRemoteUrl ────────────────────────────────────────────────────────

describe('isValidRemoteUrl', () => {
  it('accepts valid http URLs', () => {
    const result = isValidRemoteUrl('http://192.168.1.10:3000');
    expect(result.valid).toBe(true);
  });

  it('accepts valid https URLs', () => {
    const result = isValidRemoteUrl('https://sencho.example.com');
    expect(result.valid).toBe(true);
  });

  it('rejects malformed URLs', () => {
    const result = isValidRemoteUrl('not-a-url');
    expect(result.valid).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(isValidRemoteUrl('ftp://example.com').valid).toBe(false);
    expect(isValidRemoteUrl('file:///etc/passwd').valid).toBe(false);
    expect(isValidRemoteUrl('javascript:alert(1)').valid).toBe(false);
  });

  it('rejects localhost', () => {
    expect(isValidRemoteUrl('http://localhost:3000').valid).toBe(false);
    expect(isValidRemoteUrl('http://LOCALHOST:3000').valid).toBe(false);
  });

  it('rejects loopback IPs', () => {
    expect(isValidRemoteUrl('http://127.0.0.1:3000').valid).toBe(false);
    expect(isValidRemoteUrl('http://127.1.2.3').valid).toBe(false);
    // Node.js URL.hostname preserves brackets: new URL('http://[::1]').hostname === '[::1]'
    expect(isValidRemoteUrl('http://[::1]:3000').valid).toBe(false);
  });

  it('rejects 0.0.0.0', () => {
    expect(isValidRemoteUrl('http://0.0.0.0:3000').valid).toBe(false);
  });

  it('allows LAN/private IPs (users need these for local network nodes)', () => {
    // Users legitimately run Sencho nodes on their LAN
    expect(isValidRemoteUrl('http://192.168.1.100:3000').valid).toBe(true);
    expect(isValidRemoteUrl('http://10.0.0.5:3000').valid).toBe(true);
  });
});

// ─── isPathWithinBase ────────────────────────────────────────────────────────

describe('isPathWithinBase', () => {
  it('accepts paths within the base directory', () => {
    expect(isPathWithinBase('/app/compose/mystack/.env', '/app/compose/mystack')).toBe(true);
  });

  it('accepts the base directory itself', () => {
    expect(isPathWithinBase('/app/compose/mystack', '/app/compose/mystack')).toBe(true);
  });

  it('rejects paths that escape via ..', () => {
    expect(isPathWithinBase('/app/compose/mystack/../../../etc/passwd', '/app/compose/mystack')).toBe(false);
  });

  it('rejects sibling directories', () => {
    expect(isPathWithinBase('/app/compose/other-stack/.env', '/app/compose/mystack')).toBe(false);
  });
});
