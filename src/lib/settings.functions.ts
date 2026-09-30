import { createServerFn } from "@tanstack/react-start";
import { requireRenderMember } from "@/integrations/render/auth-middleware";
import { aiProvider } from "./prospect/ai.server";

export const getAiStatus = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async () => aiProvider());
