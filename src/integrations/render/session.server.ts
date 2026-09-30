import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";

const SESSION_COOKIE = "spa-intelligence-session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function cookieSecurityFlag() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function setSessionCookie(token: string) {
  setResponseHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}${cookieSecurityFlag()}`,
  );
}

export function clearSessionCookie() {
  setResponseHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${cookieSecurityFlag()}`,
  );
}

export function readSessionToken(): string | null {
  const header = getRequestHeader("cookie");
  if (!header) return null;

  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq);
    if (name !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1));
    } catch {
      return null;
    }
  }

  return null;
}
