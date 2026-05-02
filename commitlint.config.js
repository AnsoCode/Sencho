/**
 * Conventional Commits validation for Sencho. Subject lines must match
 *   <type>(<optional scope>): <subject>
 * with type drawn from the allow-list below. release-please reads commits
 * with these types from main and computes the next version + changelog,
 * so any non-conforming commit silently breaks the release pipeline.
 *
 * Scope is free-form; common scopes used in this repo include backend,
 * frontend, e2e, mesh-sidecar, docs, deps, ci, license, blueprints,
 * fleet, security.
 */
module.exports = {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'type-enum': [
            2,
            'always',
            [
                'feat',
                'fix',
                'perf',
                'revert',
                'docs',
                'style',
                'refactor',
                'test',
                'build',
                'ci',
                'chore',
                'security',
            ],
        ],
        // The default 100-char subject limit is too tight for the descriptive
        // subjects this repo prefers; loosen to 120 to match the longest
        // existing commit subjects on main without enabling unbounded sprawl.
        'header-max-length': [2, 'always', 120],
        'subject-case': [0],
    },
};
