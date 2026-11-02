import { useEffect } from 'react';

import { useSettings } from '../api/hooks';
import type { Theme } from '../api/types';
import { defaultLocale } from '../lib/money';

export function useLocale(): string {
  const { data } = useSettings();
  const l = data?.['locale.number'];
  return l && l !== 'system' ? l : defaultLocale();
}

export function useBaseCurrency(): string {
  const { data } = useSettings();
  return data?.base_currency ?? 'EUR';
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** Keeps <html data-theme> in sync with the saved preference. */
export function useThemeSync() {
  const { data } = useSettings();
  const theme = data?.theme ?? 'system';
  useEffect(() => applyTheme(theme), [theme]);
}
