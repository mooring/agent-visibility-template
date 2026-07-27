# OpenAI-Compatible Image Generation Console Design

## Goal

Replace the existing Agent Visibility explorer with a Cloudflare-deployable image generation console. A user enters a token, a complete OpenAI-compatible image generation URL, a model, a prompt, standard image parameters, and optional provider-specific JSON. The application sends the request through the same-origin Cloudflare Worker, displays URL and Base64 image results, and exposes detailed, safely redacted diagnostics in the browser.

## Scope

The first version is a single-request console. It does not persist credentials, requests, images, or logs; provide job history; retry requests automatically; or add a server-side credential store. The existing React and Hono deployment shape remains intact so Cloudflare can continue to build and deploy the repository automatically.

The current Agent Visibility user interface is completely replaced. Legacy discovery and enrichment code that is no longer reachable or required may be removed only when directly necessary to complete this product change. Unrelated refactoring is out of scope.

## Architecture

The React application sends `POST /api/images/generations` to the same-origin Hono Worker. The request contains the user-entered upstream URL, token, and image request body. The Worker validates the target and payload, forwards the body to the complete upstream endpoint with `Authorization: Bearer <token>`, reads a bounded response, parses OpenAI-compatible results, and returns display data plus redacted diagnostic events.

```text
React form
  -> POST /api/images/generations
  -> Worker validates the URL and payload
  -> Worker forwards the request to the complete upstream URL
  -> Worker parses the bounded upstream response
  -> Worker returns images and redacted diagnostics
  -> React renders images and chronological logs
```

The token exists only in React component memory and the active Worker request. It is not stored in local storage, cookies, KV, environment variables, application logs, or response data.

## User Interface

The page is an image generation console rather than an extension of the current explorer. It contains:

- A generation form.
- A result gallery.
- A chronological logs panel.

The form exposes these fields:

| Field | Behavior |
| --- | --- |
| Token | Required password input with a temporary show/hide control. |
| URL | Required complete image generation endpoint, such as `https://api.openai.com/v1/images/generations`. |
| Model | Required free-form model name. |
| Prompt | Required multiline prompt. |
| `n` | Optional positive integer with an application-defined safe maximum. |
| `size` | Optional free-form string. |
| `quality` | Optional free-form string. |
| `style` | Optional free-form string. |
| `response_format` | Optional free-form string. |
| `background` | Optional free-form string. |
| `output_compression` | Optional integer from 0 through 100. |
| `user` | Optional string. |
| Extra parameters | Optional JSON object for provider-specific fields. |

Optional empty fixed fields are omitted. Extra parameters must parse to a JSON object, not an array or primitive. `model` and `prompt` always come from their fixed fields and cannot be overridden. For all other duplicate keys, the extra JSON value wins so provider-specific types remain expressible.

The Submit button shows an in-progress state and prevents duplicate submission while the request is active. Starting a new request preserves the previous successful gallery until new results arrive. The gallery clearly labels retained results as belonging to the previous successful request if the active request fails.

## Worker API Contract

### Request

`POST /api/images/generations` accepts JSON shaped as follows:

```json
{
  "url": "https://api.openai.com/v1/images/generations",
  "token": "user-entered bearer token",
  "body": {
    "model": "gpt-image-1",
    "prompt": "A watercolor lighthouse at sunrise",
    "n": 1,
    "size": "1024x1024"
  }
}
```

The Worker independently validates all values even when the browser already validated them. It bounds the incoming body size, individual string lengths, `n`, and `output_compression`. Unsupported parameter combinations are left for the upstream service to validate so compatible providers are not artificially constrained.

### Upstream Request

The Worker forwards the supplied `body` as JSON to the exact supplied URL and adds:

```http
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json
```

It uses `redirect: "manual"`. Redirect responses are returned as upstream failures and are never followed.

### Success Response

The Worker recognizes each item in an OpenAI-compatible `data` array that contains `url`, `b64_json`, or both. It preserves response order. The response to the browser contains normalized items, timing information, a request ID, and safe diagnostic events.

URL images remain URLs. Base64 images remain Base64 values in the result payload so the browser can construct a data URL for display and download. Base64 values are excluded from diagnostic messages.

### Failure Response

Worker validation failures, network failures, timeouts, redirects, non-2xx upstream responses, invalid JSON, and successful responses without recognizable images use a consistent JSON envelope containing:

- A stable error category and human-readable message.
- A request ID.
- The upstream HTTP status and status text when available.
- A bounded, redacted upstream response body when available.
- Chronological diagnostic events safe for display.

The API never echoes the token.

## Public HTTPS Target Validation

Only complete `https:` URLs are accepted. The URL must not contain embedded username/password credentials or a fragment. Query parameters may be sent to the upstream service when included in the submitted complete URL, but neither their names nor values are exposed in logs.

The Worker rejects:

- `localhost` and localhost subdomains.
- `.local` and `.internal` hostnames.
- IP literals in loopback, private, link-local, multicast, documentation, benchmarking, unspecified, and other reserved ranges.
- Non-HTTPS schemes.
- Redirects.

Cloudflare Workers do not provide a general pre-request DNS resolution API that can reliably prove the resolved address of every hostname. The design therefore does not claim complete DNS rebinding protection. It combines strict hostname/IP-literal validation with manual redirect handling, and relies on the Cloudflare runtime not having access to a user's private LAN.

## Result Rendering

Each recognizable upstream item becomes a gallery card in original order:

- `url` is rendered with an image element and an “Open original” action.
- `b64_json` is rendered from a `data:image/...;base64,...` source and has a download action.
- If an item has both fields, both representations remain accessible without duplicating the request.
- Image element failures append a client-side error event to Logs without discarding other results.

The MIME type for Base64 display is derived only from a safe supported response hint when available and otherwise defaults to `image/png`.

## Logs and Redaction

The Logs panel is a browser-visible, timestamped sequence with `INFO`, `SUCCESS`, and `ERROR` levels. It includes client validation, request start, safe target host, redacted request parameters, Worker validation, upstream status and status text, elapsed time, response content type, selected safe response headers, response parsing, result counts/types, truncation notices, and image load failures.

It provides Clear and Copy controls.

The following values must never appear in frontend logs, Worker console logs, API diagnostics, or error messages:

- Token and `Authorization`.
- Cookies and `Set-Cookie`.
- URL query strings and fragments.
- Base64 image contents.
- Any upstream response header not explicitly allowlisted.

Request-body diagnostics replace sensitive or oversized values with summaries. Prompt text may be logged only as its character count, not its content. Successful upstream bodies are summarized instead of copied. For non-2xx responses, the bounded response body is returned as completely as safe redaction permits; JSON is formatted for display and text responses are preserved. Truncation is explicit.

Worker console messages contain only the request ID, stage, safe target hostname, status, elapsed time, and a redacted error summary.

## Response Bounds and Runtime Behavior

The Worker reads upstream responses with a fixed maximum byte limit. It cancels further reading once that limit is reached and marks the diagnostic body as truncated. The limit must be high enough for the supported Base64 image response mode while remaining bounded to prevent unrestrained memory use in a Cloudflare isolate.

No automatic retries are performed because image requests may be expensive and upstream idempotency is not guaranteed. The browser aborts its active request when the page is unloaded. A clear timeout error is returned when the configured Worker request deadline is reached.

## Testing

Worker tests cover:

- Valid public HTTPS targets and rejected schemes, credentials, local names, and reserved IP literals.
- Payload bounds and fixed/extra parameter merge results.
- URL-only, Base64-only, and mixed successful image responses.
- Redirect, non-JSON error, JSON error, timeout/network error, invalid success JSON, missing `data`, and missing recognizable images.
- Bounded response handling and explicit truncation.
- Absence of tokens, authorization values, cookies, query parameters, prompt contents, and Base64 contents from every diagnostic and response error path.

React tests cover:

- Required-field and extra-JSON validation.
- Fixed-field omission and merge precedence.
- In-progress submission state.
- URL, Base64, and mixed gallery rendering.
- Preservation and labeling of previous successful results after a failed request.
- Chronological logs, copying/clearing, redaction, and image load errors.

Final verification runs:

```bash
npm test
npm run build
npm run check
```

`npm run check` includes a Cloudflare dry-run deployment. Tests use mocked upstream fetch behavior and must not call a paid live image generation service.

## Deployment and Documentation

The existing Vite client plus Hono Worker deployment remains the deployment unit. `/api/images/generations` is included in Worker-first asset routing. No Node-only server APIs or filesystem persistence are introduced.

The README is updated during implementation to describe the new product, supported request fields, security limitations, local development, testing, and Cloudflare automatic deployment. Obsolete Agent Visibility product instructions are removed when their corresponding functionality is removed.

## Success Criteria

The feature is complete when a Cloudflare deployment lets a user enter a token, complete public HTTPS endpoint, model, prompt, standard parameters, and extra JSON; submit one OpenAI-compatible generation request through the Worker; see URL and Base64 images; and diagnose upstream failures from detailed browser logs without exposing credentials or other prohibited sensitive values.
