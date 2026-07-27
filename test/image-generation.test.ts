import { describe, expect, it } from "vitest";
import {
	normalizeImageResponse,
	redactDiagnosticText,
	sanitizeRequestBody,
	validateGenerationRequest,
	validatePublicHttpsUrl,
} from "../src/lib/image-generation";

describe("image generation helpers", () => {
	it("accepts a complete public HTTPS URL without exposing its query", () => {
		const result = validatePublicHttpsUrl(
			"https://api.example.com/v1/images/generations?route=secret",
		);
		expect(result.url.toString()).toContain("route=secret");
		expect(result.safeTarget).toBe("https://api.example.com:443");
	});

	it.each([
		"http://api.example.com/v1/images/generations",
		"https://localhost/v1/images/generations",
		"https://service.internal/v1/images/generations",
		"https://127.0.0.1/v1/images/generations",
		"https://10.0.0.1/v1/images/generations",
		"https://[::1]/v1/images/generations",
		"https://user:pass@api.example.com/v1/images/generations",
		"https://api.example.com/v1/images/generations#secret",
	])("rejects unsafe target %s", (url) => {
		expect(() => validatePublicHttpsUrl(url)).toThrow();
	});

	it("validates the request and bounds numeric parameters", () => {
		expect(() =>
			validateGenerationRequest({
				url: "https://api.example.com/v1/images/generations",
				token: "token",
				body: { model: "m", prompt: "p", n: 11 },
			}),
		).toThrow("n");
		expect(() =>
			validateGenerationRequest({
				url: "https://api.example.com/v1/images/generations",
				token: "token",
				body: { model: "m", prompt: "p", output_compression: 101 },
			}),
		).toThrow("output_compression");
	});

	it("summarizes request data without prompt or Base64 contents", () => {
		const safe = sanitizeRequestBody({
			model: "gpt-image-1",
			prompt: "private prompt",
			b64_json: "secret-image",
			n: 1,
		});
		expect(safe).toEqual({
			model: "gpt-image-1",
			prompt: "[14 characters]",
			b64_json: "[base64 omitted]",
			n: 1,
		});
	});

	it("redacts secrets, cookies, query strings, prompts and Base64 fields", () => {
		const text = redactDiagnosticText(
			JSON.stringify({
				authorization: "Bearer token-secret",
				cookie: "session=secret",
				prompt: "private prompt",
				b64_json: "image-secret",
				url: "https://api.example.com/path?api_key=secret#fragment",
			}),
			["token-secret"],
		);
		expect(text).not.toContain("token-secret");
		expect(text).not.toContain("session=secret");
		expect(text).not.toContain("private prompt");
		expect(text).not.toContain("image-secret");
		expect(text).not.toContain("api_key");
	});

	it("normalizes URL, Base64, and mixed image items in order", () => {
		const images = normalizeImageResponse({
			data: [
				{ url: "https://cdn.example.com/a.png" },
				{ b64_json: "YWJj" },
				{ url: "https://cdn.example.com/c.png", b64_json: "ZGVm" },
			],
		});
		expect(images).toHaveLength(3);
		expect(images[0]?.url).toContain("a.png");
		expect(images[1]?.b64Json).toBe("YWJj");
		expect(images[2]).toMatchObject({ b64Json: "ZGVm" });
	});
});
