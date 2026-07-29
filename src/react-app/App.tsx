import { useLayoutEffect, useState } from "react";
import type { DiagnosticEvent, GenerationImage } from "../lib/image-generation";
import { buildGenerationBody, type GenerationFields } from "./generation-form";
import { loadTheme, saveTheme, type Theme } from "./theme";
import "./App.css";

interface ApiResponse {
	requestId?: string;
	images?: GenerationImage[];
	logs?: DiagnosticEvent[];
	error?: { message: string };
	upstream?: { body?: string };
}

const INITIAL: GenerationFields = {
	model: "gpt-image-1", prompt: "", extra: "{}", n: "1", size: "1024x1024",
	quality: "", style: "", responseFormat: "", background: "", outputCompression: "", user: "",
};

export default function App() {
	const [theme, setTheme] = useState<Theme>(loadTheme);
	const [token, setToken] = useState("");
	const [url, setUrl] = useState("https://api.openai.com/v1/images/generations");
	const [showToken, setShowToken] = useState(false);
	const [fields, setFields] = useState(INITIAL);
	const [loading, setLoading] = useState(false);
	const [images, setImages] = useState<GenerationImage[]>([]);
	const [stale, setStale] = useState(false);
	const [logs, setLogs] = useState<DiagnosticEvent[]>([]);

	useLayoutEffect(() => {
		document.documentElement.dataset.theme = theme;
		saveTheme(theme);
	}, [theme]);

	function addLog(level: DiagnosticEvent["level"], message: string) {
		setLogs((current) => [...current, { time: new Date().toISOString(), level, message }]);
	}

	function setField<K extends keyof GenerationFields>(key: K, value: GenerationFields[K]) {
		setFields((current) => ({ ...current, [key]: value }));
	}

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (!token.trim()) { addLog("ERROR", "Token is required."); return; }
		if (!url.trim()) { addLog("ERROR", "Complete API URL is required."); return; }
		let body: Record<string, unknown>;
		try { body = buildGenerationBody(fields); }
		catch (error) { addLog("ERROR", (error as Error).message); return; }
		setLoading(true);
		setStale(images.length > 0);
		addLog("INFO", `Sending request to ${safeHost(url)} with prompt length ${fields.prompt.length}.`);
		try {
			const response = await fetch("/api/images/generations", {
				method: "POST", headers: { "content-type": "application/json" },
				body: JSON.stringify({ url, token, body }),
			});
			const data = await response.json() as ApiResponse;
			if (data.logs) setLogs((current) => [...current, ...data.logs!]);
			if (!response.ok || !data.images) {
				if (data.upstream?.body) addLog("ERROR", `Upstream response:\n${data.upstream.body}`);
				throw new Error(data.error?.message || `Worker returned HTTP ${response.status}.`);
			}
			setImages(data.images);
			setStale(false);
		} catch (error) {
			addLog("ERROR", error instanceof Error ? error.message : "Image generation failed.");
			setStale(images.length > 0);
		} finally { setLoading(false); }
	}

	async function copyLogs() {
		await navigator.clipboard.writeText(logs.map((log) => `${log.time} ${log.level} ${log.message}`).join("\n"));
	}

	return <main className="shell">
		<header className="hero"><div className="hero-row"><div className="hero-copy"><p className="eyebrow">Cloudflare Worker Proxy</p><h1>Image Generation Console</h1><p>Call any OpenAI-compatible public HTTPS image endpoint and inspect safe, detailed diagnostics in one place.</p></div><button className="theme-toggle" type="button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Light theme" : "Dark theme"}</button></div></header>
		<div className="workspace">
			<form className="panel form" onSubmit={submit}>
				<div className="panel-heading"><div><span>Request</span><h2>Generation settings</h2></div><span className="privacy">Token stays in memory</span></div>
				<label className="wide">Token<div className="secret"><input type={showToken ? "text" : "password"} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="sk-…" /><button type="button" onClick={() => setShowToken(!showToken)}>{showToken ? "Hide" : "Show"}</button></div></label>
				<label className="wide">Complete API URL<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required /></label>
				<label>Model<input value={fields.model} onChange={(e) => setField("model", e.target.value)} required /></label>
				<label>Number<input type="number" min="1" max="10" value={fields.n} onChange={(e) => setField("n", e.target.value)} /></label>
				<label className="wide">Prompt<textarea rows={6} value={fields.prompt} onChange={(e) => setField("prompt", e.target.value)} placeholder="Describe the image you want…" required /></label>
				{(["size", "quality", "style", "responseFormat", "background", "outputCompression", "user"] as const).map((key) => <label key={key}>{labelFor(key)}<input type={key === "outputCompression" ? "number" : "text"} min={key === "outputCompression" ? 0 : undefined} max={key === "outputCompression" ? 100 : undefined} value={fields[key]} onChange={(e) => setField(key, e.target.value)} /></label>)}
				<label className="wide">Extra parameters (JSON)<textarea className="code" rows={6} value={fields.extra} onChange={(e) => setField("extra", e.target.value)} spellCheck={false} /></label>
				<button className="primary wide" disabled={loading}>{loading ? "Generating…" : "Generate image"}</button>
			</form>

			<section className="right-column">
				<div className="panel results"><div className="panel-heading"><div><span>Output</span><h2>Generated images</h2></div>{stale && <span className="stale">Previous successful request</span>}</div>
					{images.length === 0 ? <div className="empty"><span>◇</span><p>Your generated images will appear here.</p></div> : <div className="gallery">{images.map((image, index) => <article className="image-card" key={`${index}-${image.url || image.b64Json?.slice(0, 12)}`}><img src={image.url || `data:${image.mimeType};base64,${image.b64Json}`} alt={`Generated result ${index + 1}`} onError={() => addLog("ERROR", `Image ${index + 1} could not be loaded.`)} /><div><strong>Result {index + 1}</strong>{image.url ? <a href={image.url} target="_blank" rel="noreferrer">Open original ↗</a> : <a href={`data:${image.mimeType};base64,${image.b64Json}`} download={`generated-${index + 1}.${extension(image.mimeType)}`}>Download</a>}</div></article>)}</div>}
				</div>
				<div className="panel logs"><div className="panel-heading"><div><span>Diagnostics</span><h2>Logs</h2></div><div className="actions"><button type="button" onClick={copyLogs} disabled={!logs.length}>Copy</button><button type="button" onClick={() => setLogs([])} disabled={!logs.length}>Clear</button></div></div><div className="log-stream" aria-live="polite">{logs.length === 0 ? <p className="empty-log">No requests yet.</p> : logs.map((log, index) => <div className={`log ${log.level.toLowerCase()}`} key={`${log.time}-${index}`}><time>{new Date(log.time).toLocaleTimeString()}</time><b>{log.level}</b><pre>{log.message}</pre></div>)}</div></div>
			</section>
		</div>
	</main>;
}

function safeHost(value: string) { try { const u = new URL(value); return `${u.protocol}//${u.host}`; } catch { return "the configured endpoint"; } }
function extension(mime: string) { return mime.split("/")[1]?.replace("jpeg", "jpg") || "png"; }
function labelFor(key: keyof GenerationFields) { return ({ size: "Size", quality: "Quality", style: "Style", responseFormat: "Response format", background: "Background", outputCompression: "Output compression", user: "User" } as Record<string, string>)[key] || key; }
