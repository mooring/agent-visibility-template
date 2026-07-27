import { SELF, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const BASE = "https://example.com";
const TARGET = "https://api.example.com/v1/images/generations?key=private";
const TARGET_PATH = "/v1/images/generations?key=private";

beforeAll(() => fetchMock.activate());
afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
	fetchMock.deactivate();
	fetchMock.activate();
});

function request(overrides: Record<string, unknown> = {}) {
	return SELF.fetch(`${BASE}/api/images/generations`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			url: TARGET,
			token: "top-secret-token",
			body: { model: "image-model", prompt: "private prompt", n: 1 },
			...overrides,
		}),
	});
}

describe("image generation proxy", () => {
	it("returns URL and Base64 images with safe diagnostics", async () => {
		fetchMock.get("https://api.example.com").intercept({ method: "POST", path: TARGET_PATH }).reply(200, {
			data: [{ url: "https://cdn.example.com/a.png" }, { b64_json: "YWJj" }],
		});
		const res = await request();
		expect(res.status).toBe(200);
		const json = await res.json() as { images: unknown[]; logs: unknown[] };
		expect(json.images).toHaveLength(2);
		const serialized = JSON.stringify(json.logs);
		expect(serialized).not.toContain("top-secret-token");
		expect(serialized).not.toContain("private prompt");
		expect(serialized).not.toContain("YWJj");
		expect(serialized).not.toContain("key=private");
	});

	it("returns detailed redacted upstream errors", async () => {
		fetchMock.get("https://api.example.com").intercept({ method: "POST", path: TARGET_PATH }).reply(400, {
			error: { message: "bad request", authorization: "top-secret-token" },
		});
		const res = await request();
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(text).toContain("bad request");
		expect(text).not.toContain("top-secret-token");
	});

	it("rejects unsafe targets before fetching", async () => {
		const res = await request({ url: "https://127.0.0.1/images/generations" });
		expect(res.status).toBe(400);
	});

	it("rejects redirects without following them", async () => {
		fetchMock.get("https://api.example.com").intercept({ method: "POST", path: TARGET_PATH }).reply(302, "moved", {
			headers: { location: "https://other.example.com" },
		});
		const res = await request();
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(text).toContain("302");
	});

	it("reports malformed successful responses", async () => {
		fetchMock.get("https://api.example.com").intercept({ method: "POST", path: TARGET_PATH }).reply(200, { data: [] });
		const res = await request();
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(text).toContain("recognizable images");
	});
});
