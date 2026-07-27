export interface GenerationFields {
	model: string;
	prompt: string;
	extra: string;
	n?: string;
	size?: string;
	quality?: string;
	style?: string;
	responseFormat?: string;
	background?: string;
	outputCompression?: string;
	user?: string;
}

export function buildGenerationBody(fields: GenerationFields): Record<string, unknown> {
	const model = fields.model.trim();
	const prompt = fields.prompt.trim();
	if (!model) throw new Error("Model is required.");
	if (!prompt) throw new Error("Prompt is required.");
	let extra: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(fields.extra.trim() || "{}");
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
		extra = parsed as Record<string, unknown>;
	} catch {
		throw new Error("Extra parameters must be a valid JSON object.");
	}
	const body: Record<string, unknown> = { model, prompt };
	if (fields.n?.trim()) body.n = Number(fields.n);
	if (fields.size?.trim()) body.size = fields.size.trim();
	if (fields.quality?.trim()) body.quality = fields.quality.trim();
	if (fields.style?.trim()) body.style = fields.style.trim();
	if (fields.responseFormat?.trim()) body.response_format = fields.responseFormat.trim();
	if (fields.background?.trim()) body.background = fields.background.trim();
	if (fields.outputCompression?.trim()) body.output_compression = Number(fields.outputCompression);
	if (fields.user?.trim()) body.user = fields.user.trim();
	Object.assign(body, extra, { model, prompt });
	return body;
}
