export type Theme = "dark" | "light";

export function parseTheme(value: string | null): Theme {
	return value === "light" ? "light" : "dark";
}
