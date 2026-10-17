import { createHash, randomBytes } from "node:crypto";
import { createRedisConnection } from "./redis.server";
import { markVerifiedEmail, userIdByEmail } from "./state.server";

const redis = createRedisConnection("email verification");
const PREFIX = "spa-intelligence:email-verify:";
const TTL = 30 * 60;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Delivery is deliberately stubbed. A verified sender/transport must be
 * integrated and tested before enabling enrolment in production.
 * Never log, return or expose the raw verification token.
 */
async function deliverVerification(_email: string, _token: string): Promise<void> {
  throw new Error("Email verification delivery is not configured.");
}

export async function requestEmailVerification(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const r = await redis();
  const rateKey = PREFIX + "rate:" + hash(normalized);
  const count = await r.incr(rateKey);
  if (count === 1) await r.expire(rateKey, 3600);
  if (count > 3) throw new Error("Too many verification requests. Try again later.");
  const userId = await userIdByEmail(normalized);
  if (!userId) return;
  const token = randomBytes(32).toString("base64url");
  const key = PREFIX + "token:" + hash(token);
  await r.set(key, userId, { EX: TTL });
  try {
    await deliverVerification(normalized, token);
  } catch (error) {
    await r.del(key);
    throw error;
  }
}

export async function confirmEmailVerification(token: string): Promise<void> {
  if (token.length < 32) throw new Error("Invalid or expired verification link.");
  const r = await redis();
  const userId = await r.getDel(PREFIX + "token:" + hash(token));
  if (!userId) throw new Error("Invalid or expired verification link.");
  await markVerifiedEmail(userId);
}
