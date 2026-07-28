# Detailed Backend Request Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return detailed Worker-side upstream request and response diagnostics while redacting only token and `Authorization` values.

**Architecture:** Extend the existing Hono route's diagnostic events immediately around its single upstream `fetch`. Keep the current React transport and rendering unchanged because it already displays Worker events and bounded upstream error bodies.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Vitest, `cloudflare:test` fetch mocks.

## Global Constraints

- Only token values and `Authorization` header values are redacted.
- Prompts, cookies, URL query parameters, and Base64 data remain visible.
- Do not add persistence, retries, redirects, dependencies, or a new endpoint.
- Preserve the existing 128,000-byte request limit, 25 MiB response limit, and 110-second timeout.

---

### Task 1: Detailed upstream diagnostics

**Files:**
- Modify: `test/index.test.ts`
- Modify: `src/worker/index.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: existing `DiagnosticEvent`, `event()`, `readBounded()`, and `POST /api/images/generations` response envelope.
- Produces: detailed diagnostic event messages returned in the existing `logs: DiagnosticEvent[]` field.

- [ ] **Step 1: Write a failing integration test for request and response details**

Add a test that intercepts the existing target, returns identifying response headers and a failing JSON body, then asserts the serialized logs contain the complete URL, method, request body, byte count, status, response headers, and response body. Assert that `top-secret-token` and the full `Authorization` value are absent while `private prompt` and `key=private` remain present.

```ts
it("returns detailed upstream request and response logs with credential redaction", async () => {
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
	expect(text).toContain("content-type");
	expect(text).toContain("cf-ray");
	expect(text).toContain("ray-123");
	expect(text).toContain("TLS failed");
	expect(text).not.toContain("top-secret-token");
	expect(text).not.toContain("Bearer top-secret-token");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- test/index.test.ts
```

Expected: the new test fails because current logs omit the complete URL, request body, and response headers.

- [ ] **Step 3: Add minimal credential-only diagnostic redaction**

In `src/worker/index.ts`, build the outbound headers and serialized body once. Add events before `fetch` containing the method, complete URL, headers with `authorization: "[redacted]"`, body text after replacing the exact token with `[redacted]`, and UTF-8 byte length. After `readBounded`, add events containing status, all response headers, and the response body after replacing the exact token and `Authorization` header values. For thrown fetch errors, include the error name and token-redacted message.

Use the existing `redactDiagnosticText(..., [request.token])` only where its broader redaction is still required by existing behavior; introduce a route-local exact credential replacement for the new detailed events so prompts, query parameters, cookies, and Base64 remain unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- test/index.test.ts
```

Expected: all Worker integration tests pass.

- [ ] **Step 5: Update user-facing documentation**

Update `README.md` to state that the Logs panel includes the complete request URL, request body, response headers, and response body; only token and `Authorization` values are redacted. Add an explicit warning that prompts, cookies, query parameters, and Base64 data can appear in copied logs.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm test
npm run build
npm run check
git diff --check
```

Expected: all tests pass, Vite production build succeeds, Wrangler dry-run succeeds, and `git diff --check` prints no errors.

- [ ] **Step 7: Review the final diff without committing**

Run:

```bash
git diff -- test/index.test.ts src/worker/index.ts README.md docs/superpowers/specs/2026-07-28-detailed-backend-request-logs-design.md docs/superpowers/plans/2026-07-28-detailed-backend-request-logs.md
git status --short
```

Expected: every changed line maps to detailed diagnostics or required documentation; changes remain local because no commit was requested.
