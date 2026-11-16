/**
 * Theme switch. A theme is a value of the data-theme attribute on <html>;
 * tokens.css holds the colours for each value. The choice is stored per build
 * mode, next to the save.
 */
import { storageKey } from '../kernel';
import { browserStorage, MODE } from './env';

export const THEMES = ['dark', 'light', 'parchment'] as const;
export type ThemeName = (typeof THEMES)[number];

const KEY = storageKey(MODE, 'theme');
const storage = browserStorage();

class Theme {
  current = $state<ThemeName>('dark');
}

export const theme = new Theme();

function apply(name: ThemeName): void {
  theme.current = name;
  document.documentElement.dataset.theme = name;
}

export function initTheme(): void {
  const stored = storage.getItem(KEY);
  apply(THEMES.includes(stored as ThemeName) ? (stored as ThemeName) : 'dark');
}

export function setTheme(name: ThemeName): void {
  apply(name);
  try {
    storage.setItem(KEY, name);
  } catch {
    // Storage is full or blocked. The theme still applies for this session.
  }
}
