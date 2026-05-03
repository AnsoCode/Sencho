import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'auto';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem('sencho-theme') as Theme | null;
  if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved;
  return 'dark';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );

  const isDarkMode = theme === 'dark' || (theme === 'auto' && systemDark);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    try { localStorage.setItem('sencho-theme', theme); } catch { /* ignore */ }
  }, [isDarkMode, theme]);

  const setTheme = (next: Theme) => setThemeState(next);

  return { theme, setTheme, isDarkMode } as const;
}
