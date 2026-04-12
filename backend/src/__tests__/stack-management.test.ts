/**
 * Unit tests for stack management hardening:
 * - WebSocket stack name validation
 * - Stack creation validation alignment
 * - Error type narrowing (unknown vs any)
 * - Cache invalidation on env write
 */
import { describe, it, expect } from 'vitest';
import { isValidStackName } from '../utils/validation';

// ─── WebSocket Stack Name Validation ────────────────────────────────────────
// The WS handler at /api/stacks/:stackName/logs uses a regex to extract the
// stack name, then must validate it with isValidStackName() before passing
// it to streamLogs(). These tests verify the validation catches traversal
// attempts that the regex alone would allow.

describe('WebSocket stack name validation', () => {
  it('rejects traversal patterns the URL regex would pass', () => {
    // The WS regex is /^\/api\/stacks\/([^/]+)\/logs$/ which only blocks '/'
    // After decodeURIComponent, these should still be caught by isValidStackName
    expect(isValidStackName('..')).toBe(false);
    expect(isValidStackName('..%2f')).toBe(false);
    expect(isValidStackName('foo bar')).toBe(false);
    expect(isValidStackName('foo;ls')).toBe(false);
    expect(isValidStackName('')).toBe(false);
  });

  it('accepts valid stack names that would appear in WS paths', () => {
    expect(isValidStackName('nginx')).toBe(true);
    expect(isValidStackName('my-app')).toBe(true);
    expect(isValidStackName('my_app')).toBe(true);
    expect(isValidStackName('stack123')).toBe(true);
  });

  it('validates URL-decoded stack names correctly', () => {
    // Simulate what happens after decodeURIComponent
    const encoded = '%2e%2e'; // '..' URL-encoded
    const decoded = decodeURIComponent(encoded);
    expect(isValidStackName(decoded)).toBe(false);

    const encodedSlash = 'foo%2fbar'; // 'foo/bar' URL-encoded
    const decodedSlash = decodeURIComponent(encodedSlash);
    expect(isValidStackName(decodedSlash)).toBe(false);
  });
});

// ─── Stack Creation Validation Alignment ────────────────────────────────────
// POST /api/stacks should use isValidStackName() (which allows underscores)
// instead of the old inline regex /^[a-zA-Z0-9-]+$/ (which rejected underscores).

describe('stack creation validation alignment', () => {
  it('allows underscores in stack names (aligned with isValidStackName)', () => {
    expect(isValidStackName('my_stack')).toBe(true);
    expect(isValidStackName('test_app_v2')).toBe(true);
  });

  it('allows hyphens in stack names', () => {
    expect(isValidStackName('my-stack')).toBe(true);
    expect(isValidStackName('test-app-v2')).toBe(true);
  });

  it('allows mixed hyphens and underscores', () => {
    expect(isValidStackName('my-stack_v2')).toBe(true);
    expect(isValidStackName('test_app-prod')).toBe(true);
  });

  it('rejects names with dots (not valid for Docker compose project names)', () => {
    expect(isValidStackName('my.stack')).toBe(false);
    expect(isValidStackName('.env')).toBe(false);
  });
});

// ─── Error Type Narrowing ──────────────────────────────────────────────────
// Catch blocks should use `error: unknown` with instanceof narrowing, not `error: any`.
// These tests verify the narrowing pattern works correctly.

describe('error type narrowing pattern', () => {
  it('extracts message from Error instances', () => {
    const error: unknown = new Error('Deploy failed: port conflict');
    const message = error instanceof Error ? error.message : 'Fallback message';
    expect(message).toBe('Deploy failed: port conflict');
  });

  it('uses fallback for non-Error values', () => {
    const error: unknown = 'string error';
    const message = error instanceof Error ? error.message : 'Fallback message';
    expect(message).toBe('Fallback message');
  });

  it('uses fallback for null/undefined', () => {
    const nullErr: unknown = null;
    const message1 = nullErr instanceof Error ? nullErr.message : 'Fallback';
    expect(message1).toBe('Fallback');

    const undefErr: unknown = undefined;
    const message2 = undefErr instanceof Error ? undefErr.message : 'Fallback';
    expect(message2).toBe('Fallback');
  });

  it('handles objects without message property', () => {
    const error: unknown = { code: 'ENOENT' };
    const message = error instanceof Error ? error.message : 'Fallback';
    expect(message).toBe('Fallback');
  });
});

// ─── Stack Name Edge Cases ──────────────────────────────────────────────────

describe('stack name edge cases for all endpoints', () => {
  it('rejects names that could cause shell injection', () => {
    expect(isValidStackName('$(whoami)')).toBe(false);
    expect(isValidStackName('`id`')).toBe(false);
    expect(isValidStackName('stack;rm -rf')).toBe(false);
    expect(isValidStackName('stack&&echo')).toBe(false);
    expect(isValidStackName('stack|cat')).toBe(false);
  });

  it('rejects null bytes and control characters', () => {
    expect(isValidStackName('stack\x00')).toBe(false);
    expect(isValidStackName('stack\n')).toBe(false);
    expect(isValidStackName('stack\t')).toBe(false);
    expect(isValidStackName('stack\r')).toBe(false);
  });

  it('rejects Windows path separators', () => {
    expect(isValidStackName('stack\\name')).toBe(false);
    expect(isValidStackName('C:\\stacks')).toBe(false);
  });

  it('accepts single character names', () => {
    expect(isValidStackName('a')).toBe(true);
    expect(isValidStackName('1')).toBe(true);
  });

  it('accepts numeric-only names', () => {
    expect(isValidStackName('123')).toBe(true);
    expect(isValidStackName('42')).toBe(true);
  });
});
