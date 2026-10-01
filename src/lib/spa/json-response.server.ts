import { jsonrepair } from "jsonrepair";
import { assertResearchModel } from "./model-compatibility.ts";

export class AiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number | string };
type Message = { role: string; content: string };

// Extract balanced objects, respecting braces and escapes inside JSON strings.
export function parseJsonObject<T>(raw: string): T {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const candidates = [text];
  const start = text.indexOf("{");
  if (start >= 0) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        candidates.push(text.slice(start, i + 1));
        break;
      }
    }
    // Never accept a nested fragment as a complete research response.

  }
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) return value as T;
    } catch { /* Try the next complete object. */ }
  }
  // Syntax repair only, and only for a complete outer object. Never complete a
  // truncated response: that would disguise missing findings as a successful scan.
  for (const candidate of candidates.slice(1)) {
    if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
    try {
      const value = JSON.parse(jsonrepair(candidate));
      if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) return value as T;
    } catch { /* Caller can request a new complete answer. */ }
  }
  throw new AiError("The model did not return a complete JSON object.", 502);
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => part?.type === "text" ? String(part.text ?? "") : "").join("");
  return "";
}

export async function requestJsonResponse<T>(options: {
  apiKey: string; model: string; system: string; user: string;
  tools?: unknown[]; effort?: "low" | "medium";
}): Promise<{ data: T; modelUsed: string; usage: Usage | null }> {
  assertResearchModel(options.model);
  const messages: Message[] = [
    { role: "system", content: options.system + "\nReturn one complete JSON object only. Keep prose concise, arrays bounded to the requested sizes, and strings to at most 100 words. No narration or markdown." },
    { role: "user", content: options.user },
  ];
  const signal = AbortSignal.timeout(240000);
  let jsonMode = true;
  let budget = 12000;
  const totalUsage: Usage = {};
  let sawUsage = false;
  let lastFailure = "The model returned no final answer.";
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + options.apiKey, "X-Title": "SPA Intelligence" },
        body: JSON.stringify({
          model: options.model, messages, max_tokens: budget, temperature: 0.2,
          reasoning: { effort: options.effort ?? "low" },
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          ...(options.tools ? { tools: options.tools } : {}),
        }), signal,
      });
    } catch (error) {
      if (signal.aborted) throw new AiError(`Research timed out using ${options.model}. Choose a faster model in AI & Models or retry.`, 504);
      throw error;
    }
    const body = await response.text();
    let json: any;
    try { json = JSON.parse(body); } catch { throw new AiError("OpenRouter returned an invalid response envelope.", 502); }
    if (!response.ok || json.error) {
      const status = response.ok ? 502 : response.status;
      const message = String(json.error?.message ?? `OpenRouter returned HTTP ${status}.`);
      if (status === 400 && jsonMode && /response[_ -]?format|json mode|structured/i.test(message)) { jsonMode = false; continue; }
      if (status === 401) throw new AiError("The OpenRouter key was rejected. Reconnect it in AI & Models.", status);
      if (status === 402) throw new AiError("The OpenRouter account has insufficient credits.", status);
      if (status === 429) throw new AiError("OpenRouter rate-limited this request. Retry shortly.", status);
      throw new AiError(message, status);
    }
    if (json.usage) {
      sawUsage = true;
      for (const key of ["prompt_tokens", "completion_tokens", "total_tokens", "cost"] as const) {
        if (json.usage[key] != null) totalUsage[key] = Number(totalUsage[key] ?? 0) + Number(json.usage[key]);
      }
    }
    const choice = json.choices?.[0];
    const text = contentText(choice?.message?.content);
    if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw new AiError("The selected model declined this research request.", 422);
    if (choice?.finish_reason === "length" || !text.trim()) {
      lastFailure = choice?.finish_reason === "length" ? "The model exhausted its output budget before finishing." : "The model returned no final answer.";
      budget = 24000;
      console.warn("[SPA Intelligence] Retrying incomplete AI output", { model: options.model, finishReason: choice?.finish_reason ?? "missing", attempt: attempt + 1 });
      continue;
    }
    try {
      return { data: parseJsonObject<T>(text), modelUsed: String(json.model ?? options.model), usage: sawUsage ? totalUsage : null };
    } catch {
      lastFailure = "The model returned malformed structured data.";
      // Re-format the complete supplied evidence without performing new research.
      options = { ...options, tools: undefined };
      messages.splice(0, messages.length,
        { role: "system", content: "Convert the supplied response into one valid JSON object. Preserve its facts, URLs and field names. Do not add facts or fill in missing information. No markdown or narration." },
        { role: "user", content: text },
      );
      budget = 24000;
    }
  }
  throw new AiError(`${lastFailure} Automatic retries were exhausted; nothing from this request was saved. Retry or select another model in AI & Models.`, 502);
}
