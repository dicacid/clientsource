import { createHash, randomBytes } from "node:crypto";
import { createRedisConnection } from "./redis.server";
import { markVerifiedEmail, userIdByEmail } from "./state.server";

const redis = createRedisConnection("email verification");
const PREFIX = "spa-intelligence:email-verify:";
const TTL = 30 * 60;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function deliveryConfig() {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["EMAIL_VERIFICATION_FROM"] || process.env["PASSWORD_RESET_FROM"];
  const origin = new URL(process.env["APP_ORIGIN"] || "https://spa-intelligence.onrender.com");
  if (
    !apiKey ||
    !from ||
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Email verification delivery is not configured.");
  }
  return { apiKey, from, origin: origin.origin };
}

/** Never log/return tokens or provider response bodies, including on failure. */
async function deliverVerification(
  email: string,
  token: string,
  config: ReturnType<typeof deliveryConfig>,
): Promise<void> {
  // A fragment keeps the token out of the initial HTTP request and referrer.
  const url = `${config.origin}/verify-email#token=${token}`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.from,
        to: [email],
        subject: "Verify your SPA Intelligence email",
        text: `Confirm this email for SPA Intelligence:\n\n${url}\n\nThis link expires in 30 minutes and can only be used once. If you did not request it, ignore this email.`,
      }),
    });
    if (!response.ok) throw new Error("Delivery rejected");
  } catch {
    throw new Error("Unable to send the verification email right now. Try again later.");
  }
}

// Called only with the authenticated account's email by the server function.
export async function requestEmailVerification(email: string): Promise<void> {
  const config = deliveryConfig();
  const normalized = email.trim().toLowerCase();
  const r = await redis();
  const rateKey = PREFIX + "rate:" + hash(normalized);
  // Atomic fixed window, including expiry, even if the process exits mid-request.
  const result = await r.multi().incr(rateKey).expire(rateKey, 3600, "NX").exec();
  if (Number(result[0]) > 3) throw new Error("Too many verification requests. Try again later.");
  const userId = await userIdByEmail(normalized);
  if (!userId) return;
  const token = randomBytes(32).toString("base64url");
  const key = PREFIX + "token:" + hash(token);
  await r.set(key, userId, { EX: TTL });
  try {
    await deliverVerification(normalized, token, config);
  } catch (error) {
    await r.del(key);
    throw error;
  }
}

export async function confirmEmailVerification(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid or expired verification link.");
  const r = await redis();
  const userId = await r.getDel(PREFIX + "token:" + hash(token));
  if (!userId) throw new Error("Invalid or expired verification link.");
  await markVerifiedEmail(userId);
}
