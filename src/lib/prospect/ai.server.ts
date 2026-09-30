// Server-only AI helper for the Render deployment.
import { getAiRuntime } from "@/lib/spa/openrouter.server";

export const OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash";

import { requestJsonResponse } from "@/lib/spa/json-response.server";
export { AiError } from "@/lib/spa/json-response.server";

export function aiProvider(): { provider: "openrouter" | "unconfigured"; model: string } {
  return process.env["OPENROUTER_API_KEY"]
    ? { provider: "openrouter", model: OPENROUTER_MODEL }
    : { provider: "unconfigured", model: OPENROUTER_MODEL };
}

async function requestJson<T>(apiKey: string, model: string, system: string, user: string, effort: "low" | "medium" = "low"): Promise<T> {
  return (await requestJsonResponse<T>({ apiKey, model, system, user, effort })).data;
}

async function openRouterJson<T>(system: string, user: string): Promise<T> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) throw new Error("OpenRouter is not configured yet. Add OPENROUTER_API_KEY to the Render service.");
  return requestJson<T>(apiKey, OPENROUTER_MODEL, system, user);
}

export async function aiJson<T>(system: string, user: string, _effort: "low" | "medium" = "low"): Promise<T> {
  return openRouterJson<T>(system, user);
}

export async function aiJsonForOrg<T>(
  organizationId: string,
  system: string,
  user: string,
  effort: "low" | "medium" = "low",
): Promise<T> {
  const runtime = await getAiRuntime(organizationId);
  return requestJson<T>(runtime.apiKey, runtime.model, system, user, effort);
}
