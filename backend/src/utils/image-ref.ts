const MAX_LENGTH = 255;

const IMAGE_REF_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9._\-/:@+]*[a-zA-Z0-9])?$/;

const FORBIDDEN_CHARS = /[\s;|&`$(){}\[\]<>'"\\!*?#~]/;

export function validateImageRef(ref: unknown): ref is string {
    if (typeof ref !== 'string') return false;
    const trimmed = ref.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return false;
    if (FORBIDDEN_CHARS.test(trimmed)) return false;
    if (trimmed.includes('..')) return false;
    if (!IMAGE_REF_PATTERN.test(trimmed)) return false;
    return true;
}

export function assertImageRef(ref: unknown): string {
    if (!validateImageRef(ref)) {
        throw new Error('Invalid image reference');
    }
    return ref;
}
