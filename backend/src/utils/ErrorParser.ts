export interface ErrorRule {
    id: string;
    type: 'startup' | 'runtime' | 'ambiguous';
    pattern: RegExp;
    getMessage: (matches: RegExpMatchArray) => string;
    canSilentlyRollback: boolean;
}

export class ErrorParser {
    private static rules: ErrorRule[] = [
        {
            id: 'PORT_CONFLICT',
            type: 'startup',
            pattern: /(?:bind: address already in use|ports are not available: exposing port TCP [^:]+:(\d+))/,
            getMessage: (m) => `Port ${m[1] || 'conflict'} is already in use by another service on this server.`,
            canSilentlyRollback: true
        },
        {
            id: 'NAME_CONFLICT',
            type: 'startup',
            pattern: /Conflict\. The container name "\/?([^"]+)" is already in use/,
            getMessage: (m) => `A container named '${m[1]}' already exists.`,
            canSilentlyRollback: true
        },
        {
            id: 'YAML_SYNTAX',
            type: 'startup',
            pattern: /(?:yaml: line (\d+):|mapping values are not allowed here)/,
            getMessage: (m) => m[1] ? `Syntax error in compose.yaml near line ${m[1]}.` : `Syntax error in compose.yaml.`,
            canSilentlyRollback: false
        },
        {
            id: 'MISSING_ENV',
            type: 'startup',
            pattern: /(?:invalid interpolation format|required variable ([^\s]+) is missing)/,
            getMessage: (m) => `Missing required environment variable: ${m[1] || 'Check configuration'}.`,
            canSilentlyRollback: false
        },
        {
            id: 'ARCH_MISMATCH',
            type: 'runtime',
            pattern: /(?:exec format error|does not match the specified platform)/i,
            getMessage: () => `Architecture mismatch. This image is not compatible with this server's CPU architecture.`,
            canSilentlyRollback: true
        },
        {
            id: 'MISSING_NETWORK',
            type: 'startup',
            pattern: /network ([^\s]+) declared as external, but could not be found/,
            getMessage: (m) => `The external network '${m[1]}' does not exist.`,
            canSilentlyRollback: false
        },
        {
            id: 'HOST_PORT_CONFLICT',
            type: 'startup',
            pattern: /host-mode networking can not work with published ports/,
            getMessage: () => `Network mode 'host' cannot be combined with explicit port mappings.`,
            canSilentlyRollback: false
        }
    ];

    public static parse(errorOutput: string): { message: string, rule: ErrorRule | null } {
        for (const rule of this.rules) {
            const match = errorOutput.match(rule.pattern);
            if (match) {
                return { message: rule.getMessage(match), rule };
            }
        }
        // Fallback: Extract the last meaningful line, strip Docker progress bars
        const lines = errorOutput.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.includes('Downloading') && !l.includes('Extracting') && !l.includes('Pulling') && !l.includes('Download complete'));
        const lastLine = lines.length > 0 ? lines[lines.length - 1] : 'Unknown deployment error occurred.';
        return { message: lastLine, rule: null };
    }
}
