// Server-only public-website reader. Fetches a few public pages; never logs in or bypasses anything.
const UA = "Mozilla/5.0 (compatible; PipelineProspector/1.0)";

export async function fetchPage(url: string, timeoutMs = 7000): Promise<{ url: string; html: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html" } });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return null;
    const html = (await res.text()).slice(0, 400_000);
    return { url: res.url || url, html };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function htmlToText(html: string, max = 6000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function pageMeta(html: string) {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
  const desc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    "";
  return { title, description: desc.trim() };
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|example\.|sentry|wixpress|@2x|u003e|domain\.com|email\.com|yourcompany/i;

export function extractEmails(html: string, domain: string): string[] {
  const decoded = html.replace(/&#64;|\[at\]|\(at\)/gi, "@").replace(/&#46;|\[dot\]|\(dot\)/gi, ".");
  const found = new Set<string>();
  for (const m of decoded.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase().replace(/^mailto:/, "");
    if (BAD_EMAIL.test(e)) continue;
    found.add(e);
  }
  const root = domain.replace(/^www\./, "");
  // Prefer addresses on the company's own domain.
  return [...found].sort((a, b) => Number(b.endsWith(root)) - Number(a.endsWith(root))).slice(0, 15);
}

export function extractLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  const host = new URL(base).host;
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1]!, base);
      if (u.host === host && /(contact|about|team|people|leadership|company|staff|management)/i.test(u.pathname)) out.add(u.origin + u.pathname);
    } catch {
      /* ignore */
    }
  }
  return [...out].slice(0, 4);
}

export function hostOf(input: string): string | null {
  let h = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  h = h.split(/[/?#]/)[0]!.replace(/\.$/, "");
  return h && h.includes(".") ? h : null;
}

// Ranked internal links: scores each same-host link by keyword hits in its path and anchor text.
export function rankedLinks(html: string, base: string, keywords: string[], max = 8): string[] {
  const host = new URL(base).host;
  const scores = new Map<string, number>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const u = new URL(m[1]!, base);
      if (u.host !== host || !/^https?:$/.test(u.protocol)) continue;
      if (/\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|css|js)$/i.test(u.pathname)) continue;
      const key = u.origin + u.pathname.replace(/\/$/, "");
      if (key === new URL(base).origin) continue;
      const hay = `${u.pathname} ${m[2]!.replace(/<[^>]+>/g, " ")}`.toLowerCase();
      let s = 0;
      keywords.forEach((k, i) => {
        if (new RegExp(`(^|[^a-z])${k.replace(/[-]/g, "[- _]?")}([^a-z]|$)`).test(hay)) s += keywords.length - i;
      });
      if (s > 0) scores.set(key, Math.max(scores.get(key) ?? 0, s));
    } catch {
      /* ignore */
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([u]) => u);
}

// Fetch a plain-text resource (e.g. /llms.txt). Returns null if missing or HTML.
export async function fetchText(url: string, timeoutMs = 5000, max = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": UA, Accept: "text/plain" } });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("html")) return null;
    const txt = (await res.text()).trim();
    return txt ? txt.slice(0, max) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
