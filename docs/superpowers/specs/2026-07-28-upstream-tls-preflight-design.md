# Upstream TLS Preflight Design

## Goal

Run a lightweight HTTPS preflight before each image-generation request so the
browser Logs panel can distinguish an upstream TLS/network failure from an API
business response.

## Capability boundary

Cloudflare Workers expose the HTTP result of `fetch`, but not the peer
certificate, certificate chain, TLS version, cipher suite, SNI negotiation, or
handshake transcript. The preflight therefore verifies only that the Worker can
establish HTTPS far enough to receive an HTTP response. Logs must state this
boundary and must not claim that certificate details were inspected.

## Request flow

After validating the public HTTPS target and before building or sending the
authenticated image-generation request, the Worker sends a `HEAD` request to
the exact target URL with:

- no authorization header or token;
- no request body;
- redirects disabled;
- the existing upstream timeout behavior.

Any HTTP response, including `401`, `404`, or `405`, proves that the HTTPS
connection reached the HTTP layer and is treated as a successful preflight.
The Worker then sends the existing authenticated `POST` request unchanged.

If the preflight throws a network error or returns HTTP `525`, the Worker logs
the failure and stops without sending the formal image-generation request.
Other HTTP statuses remain successful TLS preflights because they demonstrate
that an HTTP response was received.

## Diagnostics

The existing diagnostic event stream records:

- preflight method and complete target URL;
- elapsed time and returned HTTP status;
- response headers and a bounded response body when the preflight fails;
- a clear explanation that certificate and handshake details are unavailable
  through the Cloudflare Workers Fetch API;
- confirmation that the formal request was skipped after a preflight failure.

Credential redaction remains unchanged. The preflight never receives or sends
the user's token. Preflight response headers and bodies pass through the same
credential redaction used by the formal request before entering logs or the
structured upstream error envelope.

## Resource handling

The preflight response body is cancelled immediately after the status and
headers needed for diagnostics are captured, except for a `525` response where
the existing bounded reader captures the small diagnostic body. The timeout
remains active through fetch, bounded body reading, and response cancellation.
No retry is introduced. Each generation performs at most one preflight and one
formal request.

## Response behavior

A preflight network failure returns the existing `502` network-error envelope.
A preflight `525` returns a `502` upstream-error envelope containing the
upstream status, headers, bounded body, request ID, and diagnostic events. The
formal image-generation request is not sent in either case.

## Testing

Worker integration tests will verify:

- a `401` or `405` HEAD response is logged as a successful preflight and the
  authenticated POST still runs;
- a `525` HEAD response produces TLS-specific logs and prevents the POST;
- a thrown HEAD fetch error produces network diagnostics and prevents the POST;
- the preflight contains no authorization header or token;
- existing request, response-size, timeout, redirect, and redaction behavior
  remains intact.

Verification will include the focused Worker tests, full test suite, production
build, Cloudflare dry-run check, and `git diff --check`.
