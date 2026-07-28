import { Hono } from "hono";
import {
	normalizeImageResponse,
	redactDiagnosticText,
	validateGenerationRequest,
	validatePublicHttpsUrl,
	type DiagnosticEvent,
} from "../lib/image-generation";

const app = new Hono();
const MAX_REQUEST_BYTES = 128_000;
const MAX_UPSTREAM_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 110_000;

function event(level: DiagnosticEvent["level"], message: string): DiagnosticEvent {
	return { time: new Date().toISOString(), level, message };
}

function errorResponse(
	requestId: string,
	category: string,
	message: string,
	logs: DiagnosticEvent[],
	status: 400 | 502 | 504,
	upstream?: { status: number; statusText: string; body?: string; truncated?: boolean },
) {
	return { error: { category, message }, requestId, upstream, logs: [...logs, event("ERROR", message)], status };
}

async function readBounded(response: Response) {
	if (!response.body) return { text: "", truncated: false };
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let truncated = false;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		const remaining = MAX_UPSTREAM_BYTES - total;
		if (value.byteLength > remaining) {
			if (remaining > 0) chunks.push(value.slice(0, remaining));
			truncated = true;
			await reader.cancel();
			break;
		}
		chunks.push(value);
		total += value.byteLength;
	}
	const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return { text: new TextDecoder().decode(bytes), truncated };
}

function redactCredentials(value: unknown, token: string): unknown {
	if (typeof value === "string") return token ? value.split(token).join("[redacted]") : value;
	if (Array.isArray(value)) return value.map((item) => redactCredentials(item, token));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).map(([key, item]) =>
		["token", "authorization"].includes(key.toLowerCase())
			? [key, "[redacted]"]
			: [key, redactCredentials(item, token)],
	));
}

function redactCredentialText(text: string, token: string): string {
	if (!text) return text;
	const exactRedacted = token ? text.split(token).join("[redacted]") : text;
	try { return JSON.stringify(redactCredentials(JSON.parse(exactRedacted), token)); }
	catch {
		return exactRedacted
			.replace(/("(?:authorization|token)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, "$1\"[redacted]\"")
			.replace(/^(\s*(?:authorization|token)\s*:\s*).*$/gim, "$1[redacted]")
			.replace(/((?:authorization|token)\s*=\s*)[^\s,;]+/gi, "$1[redacted]");
	}
}

app.onError((error, c) => {
	const requestId = crypto.randomUUID();
	console.error(`[${requestId}] worker_error ${redactDiagnosticText(error.message)}`);
	return c.json({
		error: { category: "worker_error", message: "Unexpected Worker error." },
		requestId,
		logs: [event("ERROR", "Unexpected Worker error.")],
	}, 500);
});

app.post("/api/images/generations", async (c) => {
	const requestId = crypto.randomUUID();
	const logs: DiagnosticEvent[] = [event("INFO", `Request ${requestId} received.`)];
	const length = Number(c.req.header("content-length") ?? "0");
	if (length > MAX_REQUEST_BYTES) {
		const result = errorResponse(requestId, "validation_error", "Request body is too large.", logs, 400);
		return c.json(result, result.status);
	}

	const rawText = await c.req.text();
	if (new TextEncoder().encode(rawText).byteLength > MAX_REQUEST_BYTES) {
		const result = errorResponse(requestId, "validation_error", "Request body is too large.", logs, 400);
		return c.json(result, result.status);
	}

	let input: unknown;
	try { input = JSON.parse(rawText); }
	catch {
		const result = errorResponse(requestId, "validation_error", "Request body must be valid JSON.", logs, 400);
		return c.json(result, result.status);
	}

	let request;
	try { request = validateGenerationRequest(input); }
	catch (error) {
		const result = errorResponse(requestId, "validation_error", (error as Error).message, logs, 400);
		return c.json(result, result.status);
	}

	const target = validatePublicHttpsUrl(request.url);
	logs.push(event("INFO", `Validated public target ${target.safeTarget}.`));
	const requestBody = JSON.stringify(request.body);
	const requestHeaders = {
		accept: "application/json",
		authorization: `Bearer ${request.token}`,
		"content-type": "application/json",
	};
	logs.push(event("INFO", `Upstream request: POST ${target.url.toString()}.`));
	logs.push(event("INFO", `Request headers: ${JSON.stringify(redactCredentials(requestHeaders, request.token))}`));
	logs.push(event("INFO", `Request body bytes: ${new TextEncoder().encode(requestBody).byteLength}.`));
	logs.push(event("INFO", `Request body: ${JSON.stringify(redactCredentials(request.body, request.token))}`));
	const startedAt = Date.now();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

	let upstream: Response;
	try {
		upstream = await fetch(target.url, {
			method: "POST",
			headers: requestHeaders,
			body: requestBody,
			redirect: "manual",
			signal: controller.signal,
		});
	} catch (error) {
		clearTimeout(timeout);
		const timedOut = controller.signal.aborted;
		const message = timedOut ? "Upstream request timed out." : "Could not reach the upstream service.";
		logs.push(event("ERROR", `Upstream fetch error: ${(error as Error).name}: ${redactCredentialText((error as Error).message, request.token)}`));
		console.error(`[${requestId}] upstream_network_error ${target.url.hostname} ${redactDiagnosticText((error as Error).message, [request.token])}`);
		const result = errorResponse(requestId, timedOut ? "timeout" : "network_error", message, logs, timedOut ? 504 : 502);
		return c.json(result, result.status);
	}
	clearTimeout(timeout);

	const elapsedMs = Date.now() - startedAt;
	const body = await readBounded(upstream);
	logs.push(event("INFO", `Upstream returned ${upstream.status} ${upstream.statusText || ""} in ${elapsedMs} ms.`.trim()));
	logs.push(event("INFO", `Response headers: ${JSON.stringify(redactCredentials(Object.fromEntries(upstream.headers.entries()), request.token))}`));
	logs.push(event("INFO", `Response body: ${redactCredentialText(body.text, request.token)}`));
	if (body.truncated) logs.push(event("ERROR", `Upstream response exceeded ${MAX_UPSTREAM_BYTES} bytes and was truncated.`));

	if (!upstream.ok || upstream.status >= 300) {
		const safeBody = redactCredentialText(body.text, request.token);
		const message = `Upstream request failed with ${upstream.status} ${upstream.statusText || ""}.`.trim();
		const result = errorResponse(requestId, "upstream_error", message, logs, 502, {
			status: upstream.status, statusText: upstream.statusText, body: safeBody, truncated: body.truncated,
		});
		return c.json(result, result.status);
	}

	if (body.truncated) {
		const result = errorResponse(requestId, "response_too_large", "Successful upstream response was too large to process.", logs, 502);
		return c.json(result, result.status);
	}

	let parsed: unknown;
	try { parsed = JSON.parse(body.text); }
	catch {
		const result = errorResponse(requestId, "invalid_upstream_response", "Upstream returned invalid JSON.", logs, 502);
		return c.json(result, result.status);
	}

	try {
		const images = normalizeImageResponse(parsed);
		logs.push(event("SUCCESS", `Generated ${images.length} image result${images.length === 1 ? "" : "s"}.`));
		return c.json({ requestId, elapsedMs, images, logs });
	} catch (error) {
		const result = errorResponse(requestId, "invalid_upstream_response", (error as Error).message, logs, 502);
		return c.json(result, result.status);
	}
});

export default app;
