import { createClient, type RedisClientType } from "redis";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const AI_PREFIX = "spa-intelligence:ai:v1:";
const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

type Stored = {
  keyCipher?: string;
  keyEnding?: string;
  model?: string;
  updatedAt?: string;
};

let redisClient: RedisClientType | null = null;
let redisPromise: Promise<RedisClientType> | null = null;

async function redis() {
  if (redisClient?.isOpen) return redisClient;
  if (!redisPromise) {
    const url = process.env["REDIS_URL"];
    if (!url) throw new Error("REDIS_URL is not configured.");
    const next = createClient({ url });
    next.on("error", (error) => console.error("[SPA Intelligence AI settings]", error));
    redisPromise = next.connect().then(() => {
      redisClient = next as RedisClientType;
      return redisClient;
    });
  }
  return redisPromise;
}

function cryptoKey() {
  const secret = process.env["SPA_ENCRYPTION_KEY"];
  if (!secret || secret.length < 32) throw new Error("SPA_ENCRYPTION_KEY is not configured.");
  return createHash("sha256").update(secret).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cryptoKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString("base64");
}

function decrypt(value: string) {
  const raw = Buffer.from(value, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", cryptoKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

async function readStored(orgId: string): Promise<Stored> {
  const r = await redis();
  const raw = await r.get(AI_PREFIX + orgId);
  if (!raw) return {};
  try { return JSON.parse(raw) as Stored; } catch { return {}; }
}

async function writeStored(orgId: string, value: Stored) {
  const r = await redis();
  await r.set(AI_PREFIX + orgId, JSON.stringify(value));
}

export type OpenRouterModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextLength: number | null;
  inputModalities: string[];
  outputModalities: string[];
  promptPrice: string | null;
  completionPrice: string | null;
  supportedParameters: string[];
};

export async function fetchModelCatalog(apiKey?: string): Promise<OpenRouterModel[]> {
  const headers: Record<string,string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = "Bearer " + apiKey;
  const res = await fetch("https://openrouter.ai/api/v1/models", { headers, signal: AbortSignal.timeout(12000) });
  if (!res.ok) {
    if (res.status === 401) throw new Error("The OpenRouter API key was rejected.");
    throw new Error(`OpenRouter model catalogue returned HTTP ${res.status}.`);
  }
  const json = await res.json() as { data?: any[] };
  return (json.data ?? []).map((m) => ({
    id: String(m.id ?? ""),
    name: String(m.name ?? m.id ?? ""),
    provider: String(m.id ?? "").split("/")[0] || "unknown",
    description: String(m.description ?? ""),
    contextLength: Number.isFinite(Number(m.context_length)) ? Number(m.context_length) : null,
    inputModalities: Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities.map(String) : [],
    outputModalities: Array.isArray(m.architecture?.output_modalities) ? m.architecture.output_modalities.map(String) : [],
    promptPrice: m.pricing?.prompt != null ? String(m.pricing.prompt) : null,
    completionPrice: m.pricing?.completion != null ? String(m.pricing.completion) : null,
    supportedParameters: Array.isArray(m.supported_parameters) ? m.supported_parameters.map(String) : [],
  })).filter((m) => m.id);
}

export async function saveOpenRouterKey(orgId: string, apiKey: string) {
  const key = apiKey.trim();
  if (!key || key.length < 20) throw new Error("Enter a valid OpenRouter API key.");
  await fetchModelCatalog(key);
  const current = await readStored(orgId);
  await writeStored(orgId, {
    ...current,
    keyCipher: encrypt(key),
    keyEnding: key.slice(-4).toUpperCase(),
    model: current.model || DEFAULT_MODEL,
    updatedAt: new Date().toISOString(),
  });
  return { connected: true, keyEnding: key.slice(-4).toUpperCase() };
}

export async function disconnectOpenRouter(orgId: string) {
  const current = await readStored(orgId);
  await writeStored(orgId, { model: current.model || DEFAULT_MODEL, updatedAt: new Date().toISOString() });
}

export async function saveDefaultModel(orgId: string, model: string) {
  const models = await fetchModelCatalog();
  if (!models.some((m) => m.id === model)) throw new Error("That model is not in the current OpenRouter catalogue.");
  const current = await readStored(orgId);
  await writeStored(orgId, { ...current, model, updatedAt: new Date().toISOString() });
  return model;
}

export async function getPublicAiSettings(orgId: string) {
  const current = await readStored(orgId);
  return {
    connected: !!current.keyCipher,
    keyEnding: current.keyEnding ?? null,
    model: current.model || DEFAULT_MODEL,
    updatedAt: current.updatedAt ?? null,
  };
}

export async function getAiRuntime(orgId: string) {
  const current = await readStored(orgId);
  const envKey = process.env["OPENROUTER_API_KEY"];
  const apiKey = current.keyCipher ? decrypt(current.keyCipher) : envKey;
  if (!apiKey) throw new Error("OpenRouter is not connected. Open AI & Models, add your OpenRouter key, then retry.");
  return { apiKey, model: current.model || DEFAULT_MODEL, keySource: current.keyCipher ? "workspace" as const : "environment" as const };
}
