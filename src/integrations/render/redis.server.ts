import { createClient, type RedisClientType } from "redis";

export function createRedisConnection(label: string, factory = (url: string) => createClient({
  url,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) => retries < 3 ? Math.min(250 * 2 ** retries, 2000) : new Error("Datastore connection unavailable."),
  },
}) as RedisClientType) {
  let client: RedisClientType | null = null;
  let connecting: Promise<RedisClientType> | null = null;
  return async (): Promise<RedisClientType> => {
    if (client?.isOpen) return client;
    if (!connecting) {
      const url = process.env["REDIS_URL"];
      if (!url) throw new Error("REDIS_URL is not configured.");
      const next = factory(url);
      // Never log connection objects or credential-bearing URLs.
      next.on("error", () => console.error(`[SPA Intelligence ${label}] Datastore connection unavailable.`));
      connecting = next.connect().then(() => {
        client = next;
        connecting = null;
        return next;
      }).catch(() => {
        connecting = null;
        try { next.destroy(); } catch { /* Already closed. */ }
        throw new Error("Render datastore is temporarily unavailable. Retry shortly.");
      });
    }
    return connecting;
  };
}
