import { createServerFn } from "@tanstack/react-start";
import { datastoreHealth } from "@/integrations/render/state.server";

export const healthCheck = createServerFn({ method: "GET" }).handler(async () => {
  const datastore = await datastoreHealth();
  return {
    ok: true as const,
    service: "spa-intelligence",
    hosting: "render",
    datastore,
    environmentAiFallbackConfigured: Boolean(process.env["OPENROUTER_API_KEY"]),
    openRouterByokSupported: true,
  };
});
