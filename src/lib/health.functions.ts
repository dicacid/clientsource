import { createServerFn } from "@tanstack/react-start";
import { datastoreHealth } from "@/integrations/render/state.server";
import { aiJson, aiProvider } from "@/lib/prospect/ai.server";

export const healthCheck = createServerFn({ method: "GET" }).handler(async () => {
  const datastore = await datastoreHealth();
  let aiSmoke: unknown;
  try {
    const result = await aiJson<{ ok: boolean; message: string }>(
      "You are a connectivity test. Return JSON only.",
      'Return {"ok":true,"message":"openrouter-live"}',
      "low",
    );
    aiSmoke = { ok: true, provider: aiProvider(), result };
  } catch (error) {
    aiSmoke = {
      ok: false,
      provider: aiProvider(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    ok: true as const,
    service: "prospect-finder-b2b",
    hosting: "render",
    datastore,
    aiConfigured: Boolean(process.env["OPENROUTER_API_KEY"]),
    aiSmoke,
  };
});
