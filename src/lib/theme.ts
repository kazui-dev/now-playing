export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme-preference';
export const THEME_COLORS = {
  light: '#ffffff',
  dark: '#0f172a',
} as const;

export const getSystemTheme = (): ResolvedTheme => {
  if (typeof window === 'undefined') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
    return storedTheme;
  }

  return 'system';
};

export const applyResolvedTheme = (resolvedTheme: ResolvedTheme) => {
  const root = document.documentElement;
  const isDark = resolvedTheme === 'dark';
  
  // Disable transitions during theme change
  root.classList.add('theme-transitioning');
  
  // Apply theme
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  
  // Re-enable transitions after a frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('theme-transitioning');
    });
  });
};

export const updateThemeColor = (resolvedTheme: ResolvedTheme) => {
  document.getElementById('themeColorMeta')?.setAttribute(
    'content',
    THEME_COLORS[resolvedTheme]
  );
};
