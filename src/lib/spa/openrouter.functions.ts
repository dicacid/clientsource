import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRenderMember } from "@/integrations/render/auth-middleware";
import { disconnectOpenRouter, fetchModelCatalog, getPublicAiSettings, saveDefaultModel, saveOpenRouterKey } from "./openrouter.server";

export const getSpaAiSettings = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => getPublicAiSettings(context.organizationId));

export const getOpenRouterModels = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async () => fetchModelCatalog());

export const connectOpenRouter = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({ apiKey: z.string().min(20).max(300) }).parse(d))
  .handler(async ({ data, context }) => saveOpenRouterKey(context.organizationId, data.apiKey));

export const disconnectOpenRouterKey = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => {
    await disconnectOpenRouter(context.organizationId);
    return { connected: false };
  });

export const setOpenRouterModel = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({ model: z.string().min(2).max(250) }).parse(d))
  .handler(async ({ data, context }) => ({ model: await saveDefaultModel(context.organizationId, data.model) }));
