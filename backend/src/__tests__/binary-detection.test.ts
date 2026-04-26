/**
 * Unit tests for isBinaryBuffer from utils/binaryDetect.ts.
 *
 * The function uses byte-range sampling to classify buffers:
 * - Empty buffers are text (returns false)
 * - Any NUL byte triggers immediate binary detection
 * - More than 30% non-printable bytes in the sample triggers binary detection
 * - The sampleBytes parameter limits how many bytes are examined
 */
import { describe, it, expect } from 'vitest';
import { isBinaryBuffer } from '../utils/binaryDetect';

describe('isBinaryBuffer', () => {
  it('returns false for empty buffer', () => {
    expect(isBinaryBuffer(Buffer.alloc(0))).toBe(false);
  });

  it('returns false for plain ASCII text', () => {
    const buf = Buffer.from('hello world\nfoo: bar\n');
    expect(isBinaryBuffer(buf)).toBe(false);
  });

  it('returns false for YAML content', () => {
    const yaml = Buffer.from('services:\n  app:\n    image: nginx:latest\n');
    expect(isBinaryBuffer(yaml)).toBe(false);
  });

  it('returns true when NUL byte present', () => {
    const buf = Buffer.from([0x68, 0x65, 0x6c, 0x00, 0x6c, 0x6f]);
    expect(isBinaryBuffer(buf)).toBe(true);
  });

  it('returns true for PNG header (binary)', () => {
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 0xff)]);
    expect(isBinaryBuffer(png)).toBe(true);
  });

  it('returns true when >30% bytes are non-printable', () => {
    // 101 bytes: 70 printable 'a' (0x61) + 31 non-printable (0x01)
    // ratio = 31/101 > 0.30
    const buf = Buffer.concat([Buffer.alloc(31, 0x01), Buffer.alloc(70, 0x61)]);
    expect(isBinaryBuffer(buf)).toBe(true);
  });

  it('returns false when exactly 30% are non-printable', () => {
    // 100 bytes: 70 printable + 30 non-printable (0x01, not NUL)
    // ratio = 30/100 = 0.30, which is NOT > 0.30, so should return false
    const buf = Buffer.concat([Buffer.alloc(30, 0x01), Buffer.alloc(70, 0x61)]);
    expect(isBinaryBuffer(buf)).toBe(false);
  });

  it('respects sampleBytes=0 (empty sample returns false)', () => {
    // sampleBytes=0 means subarray(0,0) which is empty, so no bytes to check
    const buf = Buffer.from([0x00, 0x61, 0x61]);
    expect(isBinaryBuffer(buf, 0)).toBe(false);
  });

  it('only samples the first N bytes', () => {
    // First byte is printable 'a', second is NUL — only sample 1 byte, so no NUL detected
    const buf = Buffer.from([0x61, 0x00, 0x61]);
    expect(isBinaryBuffer(buf, 1)).toBe(false);
  });
});
