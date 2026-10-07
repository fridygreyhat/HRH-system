import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'hrh_theme';

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function effectiveTheme(): 'light' | 'dark' {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Light/dark toggle that remembers the viewer's choice; defaults to the OS setting. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored);
  useEffect(() => apply(theme), [theme]);
  const toggle = useCallback(() => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for this page view */
    }
    setTheme(next);
  }, []);
  return { theme, toggle };
}

apply(stored());
