import { createServerFn } from "@tanstack/react-start";
import { allowPublicResearch } from "@/integrations/render/auth-middleware";
import { aiProvider } from "./prospect/ai.server";

export const getAiStatus = createServerFn({ method: "GET" })
  .middleware([allowPublicResearch])
  .handler(async () => aiProvider());
