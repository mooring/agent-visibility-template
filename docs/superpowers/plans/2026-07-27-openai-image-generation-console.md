# OpenAI-Compatible Image Generation Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Agent Visibility template with a Cloudflare-deployable OpenAI-compatible image generation console that renders URL/Base64 results and detailed safely redacted browser logs.

**Architecture:** The React client builds a validated OpenAI-compatible body and posts the token, complete upstream URL, and body to a same-origin Hono route. Focused Worker helpers validate public HTTPS targets, bound and parse upstream responses, normalize images, and return request-correlated diagnostic events without secrets. The UI keeps credentials in component memory only and renders retained results plus chronological logs.

**Tech Stack:** TypeScript 5.9, React 19, Hono 4, Cloudflare Workers, Vite 7, Vitest Workers pool.

## Global Constraints

- Accept only complete public `https:` upstream URLs and never follow redirects.
- Never persist or log tokens, authorization values, cookies, URL query strings/fragments, prompt text, or Base64 image contents.
- Support `data[].url`, `data[].b64_json`, and mixed results.
- Preserve existing Cloudflare Vite + Worker automatic deployment shape.
- Use bounded streaming reads and no automatic retries.
- Keep changes surgical and remove obsolete Agent Visibility code only when it is no longer part of the product.

---

### Task 1: Shared request building and safe diagnostics

**Files:**
- Create: `src/lib/image-generation.ts`
- Create: `test/image-generation.test.ts`

**Interfaces:**
- Produces: request/response/log types, `validatePublicHttpsUrl`, `validateGenerationRequest`, `sanitizeRequestBody`, `redactDiagnosticText`, and `normalizeImageResponse`.

- [ ] Write focused tests for URL rejection/acceptance, request bounds, diagnostic redaction, and URL/Base64/mixed normalization.
- [ ] Run `npm test -- test/image-generation.test.ts` and verify failures are caused by the missing module.
- [ ] Implement the minimum pure helpers and types required by the tests.
- [ ] Re-run the focused tests and verify they pass.

### Task 2: Cloudflare Worker proxy endpoint

**Files:**
- Replace: `src/worker/index.ts`
- Replace: `test/index.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Consumes: Task 1 validation, redaction, normalization, and diagnostic types.
- Produces: `POST /api/images/generations` with consistent success/failure envelopes and request IDs.

- [ ] Write Worker integration tests using intercepted upstream fetches for success variants, detailed upstream errors, redirects, invalid responses, truncation, and secret non-disclosure.
- [ ] Run `npm test -- test/index.test.ts` and verify the new route tests fail.
- [ ] Implement bounded request parsing, upstream timeout/stream read, safe headers, normalized results, and diagnostic envelopes.
- [ ] Remove obsolete Worker routes/bindings from the active product configuration.
- [ ] Re-run Worker tests and all pure helper tests.

### Task 3: React image generation console

**Files:**
- Replace: `src/react-app/App.tsx`
- Replace: `src/react-app/App.css`
- Replace: `src/react-app/index.css`
- Create: `src/react-app/generation-form.ts`
- Create: `src/react-app/generation-form.test.ts`

**Interfaces:**
- Produces: `buildGenerationBody` for fixed/extra parameter validation and the full browser console.
- Consumes: Worker API request/response/log types from Task 1.

- [ ] Write pure client tests for required fields, optional omission, extra JSON object validation, and merge precedence.
- [ ] Run the focused client test and verify it fails because the helper is absent.
- [ ] Implement the form builder, then verify focused tests pass.
- [ ] Replace the page with the form, gallery, retained-result marker, password visibility control, and copy/clear logs.
- [ ] Add responsive styling and accessible loading/error states without adding a UI dependency.
- [ ] Run TypeScript/build verification to catch rendered-interface errors.

### Task 4: Documentation and final verification

**Files:**
- Replace: `README.md`
- Modify: `package.json`
- Modify: `.gitignore` only if the required `.cached/` entry is absent.

**Interfaces:**
- Documents the exact UI fields, Worker proxy behavior, limitations, local commands, and Cloudflare automatic deployment.

- [ ] Update README and package metadata from Agent Visibility to the image generation console.
- [ ] Ensure dependency cache/build locations remain ignored and no generated artifacts are staged.
- [ ] Run `npm test`, `npm run build`, `npm run check`, and `git diff --check`.
- [ ] Review the diff against every design requirement and scan for secrets or accidental legacy product text.
- [ ] Stage only task files and commit with a problem-and-approach message; do not push unless explicitly requested.
