import { describe, expect, it } from "vitest";
import { parseTheme } from "./theme";

describe("parseTheme", () => {
	it("accepts supported themes", () => {
		expect(parseTheme("dark")).toBe("dark");
		expect(parseTheme("light")).toBe("light");
	});

	it("defaults missing or invalid values to dark", () => {
		expect(parseTheme(null)).toBe("dark");
		expect(parseTheme("system")).toBe("dark");
	});
});
