# Detailed Backend Request Logs Design

## Goal

Expand the browser Logs panel with enough Worker-side request and response detail
to diagnose upstream failures without requiring access to Cloudflare's dashboard.

## Logging contract

For each upstream request, the Worker will record:

- the outbound HTTP method and complete target URL;
- outbound headers and JSON request body;
- request body byte length and request start time;
- upstream status, status text, elapsed time, response headers, and response body;
- the error name and message when `fetch` fails before receiving a response.

Only token values and `Authorization` header values are redacted. Other values,
including prompts, cookies, URL query parameters, and Base64 data, remain visible
as explicitly requested.

The existing response-size bound, timeout, redirect policy, and lack of automatic
retries remain unchanged.

## Data flow

The Worker builds diagnostic events immediately before and after the upstream
`fetch`. It returns those events through the existing JSON response envelope.
The React client continues to append the returned events to its Logs panel.

No persistent log store or new endpoint is introduced.

## Error handling

Network failures include the JavaScript error name and redacted error message.
HTTP failures include the complete redacted upstream response and response
headers. Diagnostic generation must not replace the original upstream result.

## Verification

Worker integration tests will assert that detailed request and response fields
are present and that token and `Authorization` values are absent. Focused tests,
the full test suite, production build, Cloudflare dry-run check, and diff checks
will verify the change.

## Security decision

This logging policy intentionally exposes request and response data beyond the
project's previous redaction boundary. Anyone with access to the browser Logs
panel or copied logs may see prompts, cookies, query parameters, and Base64
payloads. This is an explicit product decision for diagnostic detail.
