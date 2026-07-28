# TLS Preflight and Theme Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-fast HTTPS preflight with detailed logs before image generation and add persistent dark/light theme switching.

**Architecture:** Keep TLS preflight behavior inside the existing Hono route and verify it through intercepted Worker fetches. Keep theme parsing in a pure helper, apply the selected value to the document root from React, and replace hard-coded component colors with CSS variables.

**Tech Stack:** TypeScript, Hono, React, CSS custom properties, Vitest, `cloudflare:test` fetch mocks.

## Global Constraints

- The preflight sends `HEAD` to the exact target URL without a token, authorization header, or request body.
- Any HTTP response except `525` proves that HTTPS reached the HTTP layer.
- A preflight `525`, thrown network error, or timeout stops the formal POST request.
- Cloudflare Workers do not expose certificate-chain or TLS-handshake details; logs must say so explicitly.
- Do not add retries, redirects, dependencies, endpoints, or persistent request data.
- Support exactly `dark` and `light`; default to `dark` for missing or invalid saved values.
- Persist only the theme name under `image-console-theme`.
- Preserve the current layout, request contract, redaction behavior, and purple/status color semantics.

---

### Task 1: Upstream HTTPS preflight and diagnostics

**Files:**
- Modify: `test/index.test.ts`
- Modify: `src/worker/index.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: validated `target.url`, existing `event()`, `readBounded()`, `errorResponse()`, and diagnostic response envelope.
- Produces: one unauthenticated HEAD preflight before the existing authenticated POST.

- [ ] **Step 1: Add successful preflight interceptors to existing integration tests**

Add this helper near `request()` and call it before the POST interceptor in every test that reaches upstream:

```ts
function preflight(status = 405) {
	return fetchMock.get("https://api.example.com")
		.intercept({ method: "HEAD", path: TARGET_PATH })
		.reply(status);
}
```

- [ ] **Step 2: Write failing tests for successful and failed preflights**

Add tests that assert HEAD carries no credentials, a 405 proceeds to POST, and a 525 prevents POST:

```ts
it("runs an unauthenticated TLS preflight before the formal request", async () => {
	fetchMock.get("https://api.example.com").intercept({ method: "HEAD", path: TARGET_PATH }).reply((options) => {
		expect(options.headers).not.toHaveProperty("authorization");
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
		"error code: 525",
		{ headers: { "cf-ray": "ray-preflight" } },
	);
	const res = await request();
	const text = await res.text();
	expect(res.status).toBe(502);
	expect(text).toContain("TLS preflight failed with 525");
	expect(text).toContain("ray-preflight");
	expect(text).toContain("Formal image generation request was skipped");
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npm test -- test/index.test.ts
```

Expected: FAIL because the Worker sends POST without first consuming the HEAD interceptor and produces no preflight logs.

- [ ] **Step 4: Implement the minimal preflight before request-body logging**

In `src/worker/index.ts`, immediately after target validation:

```ts
logs.push(event("INFO", `TLS preflight: HEAD ${target.url.toString()}.`));
logs.push(event("INFO", "Cloudflare Workers can verify HTTPS reachability, but certificate and handshake details are unavailable."));
const preflightStartedAt = Date.now();
const preflightController = new AbortController();
const preflightTimeout = setTimeout(() => preflightController.abort(), UPSTREAM_TIMEOUT_MS);
let preflightResponse: Response;
try {
	preflightResponse = await fetch(target.url, {
		method: "HEAD",
		redirect: "manual",
		signal: preflightController.signal,
	});
} catch (error) {
	clearTimeout(preflightTimeout);
	const timedOut = preflightController.signal.aborted;
	logs.push(event("ERROR", `TLS preflight fetch error: ${(error as Error).name}: ${redactCredentialText((error as Error).message, request.token)}`));
	logs.push(event("ERROR", "Formal image generation request was skipped."));
	const message = timedOut ? "TLS preflight timed out." : "TLS preflight could not reach the upstream service.";
	const result = errorResponse(requestId, timedOut ? "timeout" : "network_error", message, logs, timedOut ? 504 : 502);
	return c.json(result, result.status);
}
clearTimeout(preflightTimeout);
const preflightElapsedMs = Date.now() - preflightStartedAt;
```

For status `525`, read the bounded body, log status/headers/body, append the skipped message, and return the existing `upstream_error` envelope. For every other status, cancel the response body and log:

```ts
logs.push(event("INFO", `TLS preflight succeeded with HTTP ${preflightResponse.status} in ${preflightElapsedMs} ms.`));
await preflightResponse.body?.cancel();
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm test -- test/index.test.ts
```

Expected: all Worker integration tests pass and no mock interceptors remain pending.

- [ ] **Step 6: Document the preflight behavior**

Update `README.md` to state that each generation first performs an unauthenticated HEAD preflight, 525/network failures skip POST, every other HTTP response proves HTTPS reachability, and Workers cannot print certificate or handshake internals.

- [ ] **Step 7: Commit Task 1**

```bash
git add test/index.test.ts src/worker/index.ts README.md docs/superpowers/specs/2026-07-28-upstream-tls-preflight-design.md docs/superpowers/plans/2026-07-28-tls-preflight-and-theme-toggle.md
git commit -m "feat: add upstream TLS preflight logs"
```

---

### Task 2: Persistent dark and light themes

**Files:**
- Create: `src/react-app/theme.ts`
- Create: `src/react-app/theme.test.ts`
- Modify: `src/react-app/App.tsx`
- Modify: `src/react-app/App.css`
- Modify: `src/react-app/index.css`
- Modify: `README.md`

**Interfaces:**
- Produces: `type Theme = "dark" | "light"` and `parseTheme(value: string | null): Theme`.
- Consumes: browser `localStorage`, `document.documentElement.dataset.theme`, and existing React layout.

- [ ] **Step 1: Write the failing pure theme test**

Create `src/react-app/theme.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/react-app/theme.test.ts
```

Expected: FAIL because `src/react-app/theme.ts` does not exist.

- [ ] **Step 3: Add the minimal theme helper**

Create `src/react-app/theme.ts`:

```ts
export type Theme = "dark" | "light";

export function parseTheme(value: string | null): Theme {
	return value === "light" ? "light" : "dark";
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/react-app/theme.test.ts
```

Expected: both theme-helper tests pass.

- [ ] **Step 5: Integrate persisted theme state into React**

Import `useEffect`, `parseTheme`, and `Theme`. Initialize state from `localStorage.getItem("image-console-theme")`. In an effect, assign `document.documentElement.dataset.theme = theme` and save the theme name. Add a hero-row button whose label is `Light theme` in dark mode and `Dark theme` in light mode, with a matching `aria-label`.

- [ ] **Step 6: Convert component colors to two CSS-variable palettes**

Define the existing colors under `:root,[data-theme="dark"]`, override them under `[data-theme="light"]`, and replace hard-coded page, panel, border, text, input, button, log, link, shadow, and image-background colors with variables. Add `.hero-row` and `.theme-toggle` layout rules and a narrow-screen wrapping rule without changing the workspace grid behavior.

- [ ] **Step 7: Document theme persistence**

Add a README feature bullet stating that the console includes persistent dark and light themes and stores only the selected theme name.

- [ ] **Step 8: Run full verification**

Run:

```bash
npm test
npm run build
npm run check
git diff --check
```

Expected: all tests pass, Vite build succeeds, Wrangler dry-run succeeds, and diff check has no output.

- [ ] **Step 9: Perform visual verification**

Run the local development server using project-approved cache and build directories. Check dark and light themes at desktop width and 390px width. Verify readable contrast, no horizontal overflow, theme-button wrapping, unchanged form/result/log layout, and persistence after reload.

- [ ] **Step 10: Commit Task 2**

```bash
git add src/react-app/theme.ts src/react-app/theme.test.ts src/react-app/App.tsx src/react-app/App.css README.md docs/superpowers/specs/2026-07-28-theme-toggle-design.md
git commit -m "feat: add persistent light and dark themes"
```
