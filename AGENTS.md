# AGENTS.md — Image Generation Console

Notes for AI agents working on this template.

## What this project is

A Cloudflare Worker proxy plus React console for OpenAI-compatible image
generation endpoints. The browser collects a token, complete public HTTPS URL,
model, prompt, standard parameters, and optional JSON; the Worker validates and
forwards one request, then returns normalized images and redacted diagnostics.

## Architecture

```
src/
  worker/index.ts             Hono image generation proxy route
  lib/image-generation.ts    Shared validation, redaction, and response types
  react-app/App.tsx           Image generation console
  react-app/generation-form.ts Pure form-to-request body builder
test/index.test.ts            Worker integration tests with intercepted fetches
test/image-generation.test.ts Pure validation and redaction tests
```

## Conventions

- Never persist or log the user token, authorization values, cookies, prompt
  contents, URL query strings/fragments, or Base64 image contents.
- Only accept complete public HTTPS upstream URLs and never follow redirects.
- Keep upstream response reading bounded and do not add automatic retries.
- Keep form body construction and Worker validation as pure testable helpers.

## Adding a request parameter

1. Add the fixed UI field only when it is part of the supported shared contract.
2. Map it in `src/react-app/generation-form.ts`; omit it when empty.
3. Add any required bounds to `src/lib/image-generation.ts`.
4. Cover both client merging and Worker validation in focused tests.

## Validating changes

```bash
npm test        # intercepted upstream requests; no paid API calls
npm run build   # tsc -b && vite build
npm run check   # build + Cloudflare deploy --dry-run
```
