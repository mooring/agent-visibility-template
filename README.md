# OpenAI-Compatible Image Generation Console

A Cloudflare Worker + React console for calling complete OpenAI-compatible image generation endpoints. Enter a token, public HTTPS URL, model, prompt, standard image parameters, and provider-specific JSON; the Worker proxies the request and the browser displays URL or Base64 image results with detailed redacted diagnostics.

## Features

- Complete endpoint URLs such as `https://api.openai.com/v1/images/generations`.
- OpenAI-compatible `data[].url` and `data[].b64_json` responses.
- Standard fields: `model`, `prompt`, `n`, `size`, `quality`, `style`, `response_format`, `background`, `output_compression`, and `user`.
- Extra JSON object for provider-specific parameters.
- Detailed upstream HTTP errors and response bodies in the browser Logs panel.
- Token, authorization headers, cookies, prompt contents, query strings, and Base64 image contents are excluded from diagnostics.
- Same-origin Worker proxy avoids browser CORS limitations.

## Security model

The token stays in React component memory and the active Worker request. It is not written to local storage, cookies, KV, or Cloudflare configuration.

The Worker accepts only complete `https:` URLs, rejects embedded credentials, fragments, localhost/private/reserved IP literals, `.local`, and `.internal` targets, and does not follow redirects. Cloudflare Workers do not expose a general DNS-resolution API, so the application cannot independently prove every hostname's resolved IP before requesting it.

Upstream responses are read with a fixed limit. Requests are not retried automatically because image generation may be billable and is not guaranteed to be idempotent.

## Request parameter precedence

Empty optional fixed fields are omitted. Extra parameters must be a JSON object. Extra JSON may override optional fixed fields, but `model` and `prompt` always come from their dedicated inputs.

## Local development

Install dependencies and run Vite:

```bash
npm install
npm run dev
```

No Cloudflare AI or KV binding is required.

## Testing and verification

Tests intercept upstream requests and never call a paid image generation service.

```bash
npm test
npm run build
npm run check
```

`npm run check` performs TypeScript compilation, a production Vite build, and a Cloudflare deployment dry-run.

## Cloudflare deployment

The repository remains a single Vite client plus Hono Worker deployment. Connect it to Cloudflare's Git integration for automatic deployment, or deploy manually:

```bash
npm run deploy
```

The Worker-first asset rule sends `/api/images/generations` to the Hono Worker while the root path serves the React application.

## API

`POST /api/images/generations`

```json
{
  "url": "https://api.openai.com/v1/images/generations",
  "token": "sk-...",
  "body": {
    "model": "gpt-image-1",
    "prompt": "A watercolor lighthouse at sunrise",
    "n": 1,
    "size": "1024x1024"
  }
}
```

Successful responses contain normalized `images`, a `requestId`, elapsed time, and redacted `logs`. Failures use a consistent error envelope and include bounded upstream response details when available.
