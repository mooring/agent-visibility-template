import { describe, expect, it } from "vitest";
import { loadTheme, parseTheme, saveTheme } from "./theme";

describe("parseTheme", () => {
	it("accepts supported themes", () => {
		expect(parseTheme("dark")).toBe("dark");
		expect(parseTheme("light")).toBe("light");
	});

	it("defaults missing or invalid values to dark", () => {
		expect(parseTheme(null)).toBe("dark");
		expect(parseTheme("system")).toBe("dark");
	});

	it("falls back safely when theme storage is unavailable", () => {
		const storage = {
			getItem() { throw new Error("blocked"); },
			setItem() { throw new Error("blocked"); },
		};
		expect(loadTheme(storage)).toBe("dark");
		expect(() => saveTheme("light", storage)).not.toThrow();
	});
});
