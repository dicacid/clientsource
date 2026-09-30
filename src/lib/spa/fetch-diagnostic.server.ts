import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const UA = "Mozilla/5.0 (compatible; SPAIntelligence/1.0; +https://revealingmindai.org)";
const MAX_REDIRECTS = 4;

export type FetchDiagnosticCategory =
  | "ok"
  | "dns"
  | "tls"
  | "connection"
  | "timeout"
  | "redirect"
  | "http_403"
  | "http_429"
  | "bot_protection"
  | "invalid_content_type"
  | "javascript_rendered"
  | "upstream_fetch_failure"
  | "parser_failure"
  | "robots_policy_restriction";

export type FetchDiagnostic = {
  ok: boolean;
  category: FetchDiagnosticCategory;
  url: string;
  httpStatus: number | null;
  contentType: string | null;
  message: string;
  html?: string;
};

function privateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip.includes(":")) {
    if (ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") ||
        ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") ||
        ip.startsWith("feb") || ip.startsWith("ff")) return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mapped ? privateAddress(mapped) : false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

async function publicUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw Object.assign(new Error("Invalid URL."), { code: "INVALID_URL" }); }

  if (!["http:", "https:"].includes(url.protocol)) throw Object.assign(new Error("Only public HTTP(S) URLs are allowed."), { code: "POLICY" });
  if (url.username || url.password) throw Object.assign(new Error("Credential-bearing URLs are not allowed."), { code: "POLICY" });

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw Object.assign(new Error("Local network destinations are not allowed."), { code: "POLICY" });
  }
  if (isIP(hostname)) {
    if (privateAddress(hostname)) throw Object.assign(new Error("Private network destinations are not allowed."), { code: "POLICY" });
    return url;
  }

  let addresses;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); }
  catch (error) { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { code: "DNS" }); }

  if (!addresses.some((entry) => !privateAddress(entry.address))) {
    throw Object.assign(new Error("DNS returned no usable public destination."), { code: "DNS" });
  }
  return url;
}

function categoryFromError(error: unknown): FetchDiagnosticCategory {
  const e = error as { message?: string; code?: string; cause?: { code?: string; message?: string } };
  const code = String(e.code ?? e.cause?.code ?? "").toUpperCase();
  const message = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  if (code === "DNS" || /ENOTFOUND|EAI_AGAIN|DNS|getaddrinfo/i.test(message)) return "dns";
  if (/CERT|TLS|SSL|certificate|handshake/i.test(code + " " + message)) return "tls";
  if (/ABORT|TIMEOUT|ETIMEDOUT/i.test(code + " " + message)) return "timeout";
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|connection/i.test(code + " " + message)) return "connection";
  if (/redirect/i.test(message)) return "redirect";
  if (code === "POLICY") return "robots_policy_restriction";
  return "upstream_fetch_failure";
}

function looksBotBlocked(html: string) {
  return /cloudflare|checking your browser|verify you are human|access denied|captcha|bot protection|incapsula|akamai/i.test(html.slice(0, 25000));
}

function looksJsOnly(html: string) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return withoutScripts.length < 160 && /<script|__next|__nuxt|root|app/i.test(html);
}

export async function diagnosePublicPage(raw: string, timeoutMs = 12000): Promise<FetchDiagnostic> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let current = raw;
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const url = await publicUrl(current);
      let response: Response;
      try {
        response = await fetch(url, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          },
        });
      } catch (error) {
        return { ok: false, category: categoryFromError(error), url: current, httpStatus: null, contentType: null, message: error instanceof Error ? error.message : String(error) };
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === MAX_REDIRECTS) {
          return { ok: false, category: "redirect", url: current, httpStatus: response.status, contentType: response.headers.get("content-type"), message: "Too many redirects." };
        }
        const location = response.headers.get("location");
        if (!location) {
          return { ok: false, category: "redirect", url: current, httpStatus: response.status, contentType: response.headers.get("content-type"), message: "Redirect response did not include a Location header." };
        }
        current = new URL(location, url).toString();
        continue;
      }

      const contentType = response.headers.get("content-type");
      const text = (await response.text().catch(() => "")).slice(0, 400_000);
      if (response.status === 403) {
        const bot = looksBotBlocked(text);
        return { ok: false, category: bot ? "bot_protection" : "http_403", url: response.url || current, httpStatus: 403, contentType, message: bot ? "The site returned HTTP 403 with a bot-protection/interstitial response." : "The site returned HTTP 403 Forbidden." };
      }
      if (response.status === 429) {
        return { ok: false, category: "http_429", url: response.url || current, httpStatus: 429, contentType, message: "The site returned HTTP 429 Too Many Requests." };
      }
      if (!response.ok) {
        return { ok: false, category: "upstream_fetch_failure", url: response.url || current, httpStatus: response.status, contentType, message: `The site returned HTTP ${response.status}.` };
      }
      if (!contentType || (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml"))) {
        return { ok: false, category: "invalid_content_type", url: response.url || current, httpStatus: response.status, contentType, message: `Expected HTML but received ${contentType || "an unspecified content type"}.` };
      }
      if (!text.trim()) {
        return { ok: false, category: "parser_failure", url: response.url || current, httpStatus: response.status, contentType, message: "The server returned an empty HTML response." };
      }
      if (looksBotBlocked(text)) {
        return { ok: false, category: "bot_protection", url: response.url || current, httpStatus: response.status, contentType, message: "The returned HTML appears to be a bot-protection/interstitial page." };
      }
      if (looksJsOnly(text)) {
        return { ok: false, category: "javascript_rendered", url: response.url || current, httpStatus: response.status, contentType, message: "The page returned HTML but meaningful content appears to require JavaScript rendering.", html: text };
      }
      return { ok: true, category: "ok", url: response.url || current, httpStatus: response.status, contentType, message: "Direct public HTML retrieval succeeded.", html: text };
    }
    return { ok: false, category: "redirect", url: current, httpStatus: null, contentType: null, message: "Too many redirects." };
  } catch (error) {
    return { ok: false, category: categoryFromError(error), url: current, httpStatus: null, contentType: null, message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}
