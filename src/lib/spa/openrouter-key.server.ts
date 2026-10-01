export async function validateOpenRouterKey(apiKey: string) {
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Accept: "application/json", Authorization: "Bearer " + apiKey },
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401 || response.status === 403) throw new Error("The OpenRouter API key was rejected.");
  if (!response.ok) throw new Error(`OpenRouter key validation returned HTTP ${response.status}.`);
  const payload = await response.json() as { data?: { is_management_key?: boolean; is_provisioning_key?: boolean }; error?: unknown };
  if (!payload.data || payload.error) throw new Error("OpenRouter did not validate this API key.");
  if (payload.data.is_management_key || payload.data.is_provisioning_key) throw new Error("Use an OpenRouter inference key, not a management key.");
}
