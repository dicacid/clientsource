// Server-only Lovable AI Gateway helper (OpenAI Responses, streamed, accumulated server-side).
const MODEL = "openai/gpt-6-astra";

export class AiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function aiJson<T>(system: string, user: string, effort: "low" | "medium" = "low"): Promise<T> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new AiError("AI is not configured for this project.", 500);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: "system", content: system + "\nRespond with a single valid JSON object only. No markdown." },
        { role: "user", content: user },
      ],
      stream: true,
      store: false,
      reasoning: { effort },
      text: { format: { type: "json_object" } },
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    let msg = "The AI service returned an error.";
    try {
      msg = JSON.parse(body)?.error?.message ?? JSON.parse(body)?.message ?? msg;
    } catch {
      /* keep default */
    }
    if (res.status === 402) msg = "AI credits are used up. Add credits in Settings → Plans & credits.";
    if (res.status === 429) msg = "The AI is busy right now. Wait a minute and try again.";
    console.error("AI gateway error", res.status, body.slice(0, 500));
    throw new AiError(msg, res.status);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let refused = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data);
          if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
          else if (ev.type === "response.refusal.delta") refused = true;
          else if (ev.type === "error" || ev.type === "response.failed")
            throw new AiError(ev.error?.message ?? ev.response?.error?.message ?? "AI request failed.", 500);
        } catch (e) {
          if (e instanceof AiError) throw e;
        }
      }
    }
  }
  if (refused && !text) throw new AiError("The AI declined this request.", 400);
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new AiError("The AI returned an unreadable answer. Try again.", 500);
  }
}
