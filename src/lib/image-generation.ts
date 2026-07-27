export type LogLevel = "INFO" | "SUCCESS" | "ERROR";

export interface DiagnosticEvent {
	time: string;
	level: LogLevel;
	message: string;
}

export interface GenerationImage {
	url?: string;
	b64Json?: string;
	mimeType: string;
}

export interface GenerationRequest {
	url: string;
	token: string;
	body: Record<string, unknown>;
}

const PRIVATE_V4 = [
	/^0\./,
	/^10\./,
	/^127\./,
	/^169\.254\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^192\.168\./,
	/^224\./,
	/^2(?:2[5-9]|3\d)\./,
];

export function validatePublicHttpsUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("URL must be a complete HTTPS URL.");
	}
	if (url.protocol !== "https:") throw new Error("URL must use HTTPS.");
	if (url.username || url.password) throw new Error("URL credentials are forbidden.");
	if (url.hash) throw new Error("URL fragments are forbidden.");
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		PRIVATE_V4.some((pattern) => pattern.test(host)) ||
		host === "::" ||
		host === "::1" ||
		host.startsWith("fc") ||
		host.startsWith("fd") ||
		host.startsWith("fe8") ||
		host.startsWith("fe9") ||
		host.startsWith("fea") ||
		host.startsWith("feb")
	) {
		throw new Error("URL must target a public host.");
	}
	return { url, safeTarget: `https://${url.hostname}:${url.port || "443"}` };
}

export function validateGenerationRequest(value: unknown): GenerationRequest {
	if (!value || typeof value !== "object") throw new Error("Request must be a JSON object.");
	const request = value as Partial<GenerationRequest>;
	validatePublicHttpsUrl(String(request.url ?? ""));
	if (!request.token || typeof request.token !== "string" || request.token.length > 8192)
		throw new Error("Token is required and must be at most 8192 characters.");
	if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
		throw new Error("body must be a JSON object.");
	const { model, prompt, n, output_compression: compression } = request.body;
	if (typeof model !== "string" || !model.trim() || model.length > 200)
		throw new Error("model is required and must be at most 200 characters.");
	if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 32_000)
		throw new Error("prompt is required and must be at most 32000 characters.");
	if (n !== undefined && (!Number.isInteger(n) || Number(n) < 1 || Number(n) > 10))
		throw new Error("n must be an integer from 1 through 10.");
	if (compression !== undefined && (!Number.isInteger(compression) || Number(compression) < 0 || Number(compression) > 100))
		throw new Error("output_compression must be an integer from 0 through 100.");
	return request as GenerationRequest;
}

export function sanitizeRequestBody(body: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(body).map(([key, value]) => {
		const lower = key.toLowerCase();
		if (lower === "prompt") return [key, `[${String(value).length} characters]`];
		if (lower.includes("b64") || lower.includes("base64")) return [key, "[base64 omitted]"];
		if (lower.includes("token") || lower === "authorization" || lower.includes("cookie")) return [key, "[redacted]"];
		return [key, value];
	}));
}

export function redactDiagnosticText(text: string, secrets: string[] = []): string {
	let output = text;
	for (const secret of secrets) if (secret) output = output.split(secret).join("[redacted]");
	output = output.replace(/https:\/\/([^\s"?#]+)(?:[^\s"]*)/gi, "https://$1/[path redacted]");
	output = output.replace(/("?(?:authorization|cookie|set-cookie|token)"?\s*[:=]\s*)"?[^,"}\s]+/gi, "$1[redacted]");
	output = output.replace(/("?prompt"?\s*:\s*)"(?:\\.|[^"\\])*"/gi, "$1\"[prompt omitted]\"");
	output = output.replace(/("?(?:b64_json|base64)[^" ]*"?\s*:\s*)"(?:\\.|[^"\\])*"/gi, "$1\"[base64 omitted]\"");
	return output;
}

export function normalizeImageResponse(value: unknown): GenerationImage[] {
	if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data))
		throw new Error("Upstream success response must contain a data array.");
	const images = (value as { data: unknown[] }).data.flatMap((item) => {
		if (!item || typeof item !== "object") return [];
		const raw = item as { url?: unknown; b64_json?: unknown; output_format?: unknown };
		const url = typeof raw.url === "string" && raw.url ? raw.url : undefined;
		const b64Json = typeof raw.b64_json === "string" && raw.b64_json ? raw.b64_json : undefined;
		if (!url && !b64Json) return [];
		const format = typeof raw.output_format === "string" ? raw.output_format.toLowerCase() : "png";
		const mimeType = ["jpeg", "jpg", "webp", "png"].includes(format)
			? `image/${format === "jpg" ? "jpeg" : format}` : "image/png";
		return [{ url, b64Json, mimeType }];
	});
	if (!images.length) throw new Error("Upstream response did not contain recognizable images.");
	return images;
}
