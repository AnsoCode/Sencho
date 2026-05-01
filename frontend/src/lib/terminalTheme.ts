/**
 * Resolves design-system CSS tokens to concrete color strings for xterm.js.
 *
 * xterm's canvas renderer does not accept CSS variable references or oklch()
 * values — it needs resolved strings. Calling this function at component mount
 * (after the DOM is ready) produces a theme object wired to the active color
 * scheme without embedding any hex literals.
 */
function resolveToken(styles: CSSStyleDeclaration, token: string, fallback = 'oklch(0 0 0)'): string {
  return styles.getPropertyValue(token).trim() || fallback;
}

export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * Builds the xterm theme from CSS custom properties. Must be called after the
 * document has loaded so getComputedStyle returns the active theme values.
 *
 * ANSI slots are mapped to design-system semantic roles where applicable:
 *   cyan  → --brand (primary data color)
 *   green → --success
 *   yellow → --warning
 *   red   → --destructive
 * Other ANSI slots use neutral grays derived from --terminal-fg/bg.
 */
export function buildXtermTheme(): XtermTheme {
  const s = getComputedStyle(document.documentElement);
  const bg = resolveToken(s, '--terminal-bg');
  const fg = resolveToken(s, '--terminal-fg');
  const brand = resolveToken(s, '--brand');
  const success = resolveToken(s, '--success');
  const warning = resolveToken(s, '--warning');
  const destructive = resolveToken(s, '--destructive');

  return {
    background: bg,
    foreground: fg,
    cursor: resolveToken(s, '--terminal-cursor'),
    cursorAccent: resolveToken(s, '--terminal-cursor-accent'),
    selectionBackground: resolveToken(s, '--terminal-selection'),

    // ANSI palette aligned to semantic roles
    black: 'oklch(0.30 0 0)',
    red: destructive,
    green: success,
    yellow: warning,
    blue: brand,
    magenta: 'oklch(0.70 0.15 300)',
    cyan: brand,
    white: 'oklch(0.70 0 0)',
    brightBlack: 'oklch(0.43 0 0)',
    brightRed: 'oklch(0.76 0.18 20)',
    brightGreen: 'oklch(0.83 0.16 155)',
    brightYellow: 'oklch(0.87 0.14 75)',
    brightBlue: brand,
    brightMagenta: 'oklch(0.80 0.12 300)',
    brightCyan: brand,
    brightWhite: fg,
  };
}

/**
 * Minimal xterm theme for modal/exec contexts that only override the
 * background, foreground, cursor, and selection. The ANSI palette inherits
 * defaults, which is fine for command output that rarely uses ANSI colors.
 */
export function buildXtermMinimalTheme(): Pick<
  XtermTheme,
  'background' | 'foreground' | 'cursor' | 'cursorAccent' | 'selectionBackground'
> {
  const s = getComputedStyle(document.documentElement);
  return {
    background: resolveToken(s, '--terminal-bg'),
    foreground: resolveToken(s, '--terminal-fg'),
    cursor: resolveToken(s, '--terminal-cursor'),
    cursorAccent: resolveToken(s, '--terminal-cursor-accent'),
    selectionBackground: resolveToken(s, '--terminal-selection'),
  };
}
