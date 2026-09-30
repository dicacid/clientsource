// Server-only AI helper for the Render deployment.
export const OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash";

export class AiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function aiProvider(): { provider: "openrouter" | "unconfigured"; model: string } {
  return process.env["OPENROUTER_API_KEY"]
    ? { provider: "openrouter", model: OPENROUTER_MODEL }
    : { provider: "unconfigured", model: OPENROUTER_MODEL };
}

function parseJson<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^\`\`\`(?:json)?/i, "")
    .replace(/\`\`\`$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new AiError("The AI returned an unreadable answer. Try again.", 500);
  }
}

async function openRouterJson<T>(system: string, user: string): Promise<T> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) throw new AiError("OpenRouter is not configured yet. Add OPENROUTER_API_KEY to the Render service.", 503);

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
      "HTTP-Referer": "https://clientsource.onrender.com",
      "X-Title": "ClientSource",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: system + "\nRespond with a single valid JSON object only. No markdown." },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = "OpenRouter returned an error.";
    try {
      message = JSON.parse(body)?.error?.message ?? message;
    } catch {
      /* keep default */
    }
    if (response.status === 401) message = "The OpenRouter API key was rejected.";
    if (response.status === 402) message = "The OpenRouter account is out of credits.";
    if (response.status === 429) message = "OpenRouter is busy right now. Wait a minute and try again.";
    console.error("OpenRouter error", response.status, body.slice(0, 500));
    throw new AiError(message, response.status);
  }

  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new AiError("The AI returned an empty answer. Try again.", 500);
  return parseJson<T>(text);
}

export async function aiJson<T>(system: string, user: string, _effort: "low" | "medium" = "low"): Promise<T> {
  return openRouterJson<T>(system, user);
}
