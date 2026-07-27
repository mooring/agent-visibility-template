import { describe, expect, it } from "vitest";
import { buildGenerationBody } from "./generation-form";

describe("buildGenerationBody", () => {
	it("requires model and prompt", () => {
		expect(() => buildGenerationBody({ model: "", prompt: "p", extra: "{}" })).toThrow("Model");
		expect(() => buildGenerationBody({ model: "m", prompt: "", extra: "{}" })).toThrow("Prompt");
	});

	it("omits empty optional fields", () => {
		expect(buildGenerationBody({ model: "m", prompt: "p", extra: "{}", size: "" }))
			.toEqual({ model: "m", prompt: "p" });
	});

	it("requires extra parameters to be an object", () => {
		expect(() => buildGenerationBody({ model: "m", prompt: "p", extra: "[]" })).toThrow("object");
	});

	it("allows extra fields to override optional fields but not model or prompt", () => {
		expect(buildGenerationBody({
			model: "fixed-model", prompt: "fixed-prompt", size: "1024x1024",
			extra: JSON.stringify({ model: "bad", prompt: "bad", size: { width: 512 }, custom: true }),
		})).toEqual({ model: "fixed-model", prompt: "fixed-prompt", size: { width: 512 }, custom: true });
	});
});
