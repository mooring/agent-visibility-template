export type Theme = "dark" | "light";

interface ThemeStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const THEME_KEY = "image-console-theme";

export function parseTheme(value: string | null): Theme {
	return value === "light" ? "light" : "dark";
}

export function loadTheme(storage?: ThemeStorage): Theme {
	try {
		const source = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
		return parseTheme(source?.getItem(THEME_KEY) ?? null);
	} catch { return "dark"; }
}

export function saveTheme(theme: Theme, storage?: ThemeStorage): void {
	try {
		const target = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
		target?.setItem(THEME_KEY, theme);
	} catch { /* Storage may be disabled by browser policy. */ }
}
