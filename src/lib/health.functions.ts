import { createServerFn } from "@tanstack/react-start";
import { datastoreHealth } from "@/integrations/render/state.server";
import { aiJson, aiProvider } from "@/lib/prospect/ai.server";

export const healthCheck = createServerFn({ method: "GET" }).handler(async () => {
  const datastore = await datastoreHealth();
  let aiLarge: unknown;
  try {
    const filler = "Company website text about services, operations, customers and workflow. ".repeat(420);
    const result = await aiJson<{ ok: boolean; message: string }>(
      "You are a connectivity and realistic-payload test. Return JSON only.",
      filler + '\nReturn {"ok":true,"message":"large-openrouter-live"}',
      "medium",
    );
    aiLarge = { ok: true, provider: aiProvider(), result };
  } catch (error) {
    aiLarge = { ok: false, provider: aiProvider(), error: error instanceof Error ? error.message : String(error) };
  }
  return {
    ok: true as const,
    service: "clientsource",
    hosting: "render",
    datastore,
    aiConfigured: Boolean(process.env["OPENROUTER_API_KEY"]),
    aiLarge,
  };
});
