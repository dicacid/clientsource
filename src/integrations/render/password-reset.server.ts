import { createHash, randomBytes } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { resetPasswordForUser, userIdByEmail } from "./state.server";

const RESET_PREFIX = "spa-intelligence:password-reset:";
const RESET_TTL_SECONDS = 60 * 30;

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

async function redis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;
  if (!connectPromise) {
    const url = process.env["REDIS_URL"];
    if (!url) throw new Error("REDIS_URL is not configured.");
    const next = createClient({ url });
    next.on("error", (error) => console.error("[SPA Intelligence password reset]", error));
    connectPromise = next.connect().then(() => {
      client = next as RedisClientType;
      return client;
    });
  }
  return connectPromise;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function sendResetEmail(email: string, resetUrl: string) {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["PASSWORD_RESET_FROM"];
  if (!apiKey || !from) throw new Error("Password reset email is not configured.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Reset your SPA Intelligence password",
      text: [
        "A password reset was requested for your SPA Intelligence account.",
        "",
        "Use this link within 30 minutes:",
        resetUrl,
        "",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#161616">
          <h2 style="margin:0 0 16px">Reset your SPA Intelligence password</h2>
          <p>A password reset was requested for your SPA Intelligence account.</p>
          <p style="margin:24px 0">
            <a href="${resetUrl}" style="background:#f58220;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;display:inline-block">
              Reset password
            </a>
          </p>
          <p>This link expires in 30 minutes and can only be used once.</p>
          <p style="color:#666;font-size:13px">If you did not request this, you can ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[SPA Intelligence password reset email]", response.status, detail);
    throw new Error("Unable to send the password reset email right now.");
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  const userId = await userIdByEmail(email);
  if (!userId) return;

  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  const r = await redis();

  await r.set(RESET_PREFIX + hash, userId, { EX: RESET_TTL_SECONDS });

  const origin = (process.env["APP_ORIGIN"] || "https://spa-intelligence.onrender.com").replace(/\/$/, "");
  const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendResetEmail(email.trim().toLowerCase(), resetUrl);
  } catch (error) {
    await r.del(RESET_PREFIX + hash);
    throw error;
  }
}

export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  if (!token || token.length < 20) throw new Error("Reset link is invalid or has expired.");

  const r = await redis();
  const key = RESET_PREFIX + tokenHash(token);
  const userId = await r.getDel(key);

  if (!userId) throw new Error("Reset link is invalid or has expired.");

  await resetPasswordForUser(userId, password);
}
