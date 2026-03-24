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
