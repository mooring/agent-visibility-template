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

function preflight(status = 405) {
	return fetchMock.get("https://api.example.com")
		.intercept({ method: "HEAD", path: TARGET_PATH })
		.reply(status);
}

describe("image generation proxy", () => {
	it("returns URL and Base64 images with credential-redacted diagnostics", async () => {
		preflight();
		fetchMock.get("https://api.example.com").intercept({ method: "POST", path: TARGET_PATH }).reply(200, {
			data: [{ url: "https://cdn.example.com/a.png" }, { b64_json: "YWJj" }],
		});
		const res = await request();
		expect(res.status).toBe(200);
		const json = await res.json() as { images: unknown[]; logs: unknown[] };
		expect(json.images).toHaveLength(2);
		const serialized = JSON.stringify(json.logs);
		expect(serialized).not.toContain("top-secret-token");
		expect(serialized).toContain("private prompt");
		expect(serialized).toContain("YWJj");
		expect(serialized).toContain("key=private");
	});

	it("returns detailed redacted upstream errors", async () => {
		preflight();
		fetchMock.get("https://api.example.com").intercept({ method: "POST", path: TARGET_PATH }).reply(
			400,
			"bad request\nauthorization: Bearer upstream-secret\ncookie: visible-cookie",
		);
		const res = await request();
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(text).toContain("bad request");
		expect(text).not.toContain("top-secret-token");
		expect(text).not.toContain("upstream-secret");
		expect(text).toContain("visible-cookie");
	});

	it("returns detailed upstream request and response logs with credential redaction", async () => {
		preflight();
		fetchMock.get("https://api.example.com").intercept({ method: "POST", path: TARGET_PATH }).reply(525, {
			error: { message: "TLS failed" },
		}, { headers: { "content-type": "application/json", "cf-ray": "ray-123" } });
		const res = await request();
		const text = await res.text();
		expect(res.status).toBe(502);
		expect(text).toContain("POST");
		expect(text).toContain(TARGET);
		expect(text).toContain("private prompt");
		expect(text).toContain("key=private");
		expect(text).toMatch(/Request body bytes: \d+/);
		expect(text).toContain("content-type");
		expect(text).toContain("cf-ray");
		expect(text).toContain("ray-123");
		expect(text).toContain("TLS failed");
		expect(text).not.toContain("top-secret-token");
		expect(text).not.toContain("Bearer top-secret-token");
	});

	it("runs an unauthenticated TLS preflight before the formal request", async () => {
		fetchMock.get("https://api.example.com").intercept({ method: "HEAD", path: TARGET_PATH }).reply((options) => {
			expect(JSON.stringify(options.headers)).not.toContain("authorization");
			expect(JSON.stringify(options.headers)).not.toContain("top-secret-token");
			return { statusCode: 405, data: "" };
		});
		fetchMock.get("https://api.example.com").intercept({ method: "POST", path: TARGET_PATH }).reply(200, {
			data: [{ url: "https://cdn.example.com/a.png" }],
		});
		const text = await (await request()).text();
		expect(text).toContain("TLS preflight succeeded with HTTP 405");
		expect(text).toContain("certificate and handshake details are unavailable");
	});

	it("stops before POST when TLS preflight returns 525", async () => {
		fetchMock.get("https://api.example.com").intercept({ method: "HEAD", path: TARGET_PATH }).reply(
			525,
			JSON.stringify({ authorization: "Bearer body-secret", token: "body-secret" }),
			{ headers: { authorization: "Bearer upstream-secret", "cf-ray": "ray-preflight", "x-request-token": "top-secret-token" } },
		);
		const res = await request();
		const text = await res.text();
		expect(res.status).toBe(502);
		expect(text).toContain("TLS preflight failed with 525");
		expect(text).toContain("ray-preflight");
		expect(text).toContain("Formal image generation request was skipped");
		expect(text).not.toContain("top-secret-token");
		expect(text).not.toContain("upstream-secret");
		expect(text).not.toContain("body-secret");
	});

	it("stops before POST when TLS preflight cannot connect", async () => {
		fetchMock.get("https://api.example.com")
			.intercept({ method: "HEAD", path: TARGET_PATH })
			.replyWithError(new Error("connection refused"));
		const res = await request();
		const text = await res.text();
		expect(res.status).toBe(502);
		expect(text).toContain("TLS preflight fetch error: Error: connection refused");
		expect(text).toContain("Formal image generation request was skipped");
	});

	it("rejects unsafe targets before fetching", async () => {
		const res = await request({ url: "https://127.0.0.1/images/generations" });
		expect(res.status).toBe(400);
	});

	it("rejects redirects without following them", async () => {
		preflight();
		fetchMock.get("https://api.example.com").intercept({ method: "POST", path: TARGET_PATH }).reply(302, "moved", {
			headers: { location: "https://other.example.com" },
		});
		const res = await request();
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(text).toContain("302");
	});

	it("reports malformed successful responses", async () => {
		preflight();
		fetchMock.get("https://api.example.com").intercept({ method: "POST", path: TARGET_PATH }).reply(200, { data: [] });
		const res = await request();
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(text).toContain("recognizable images");
	});
});
