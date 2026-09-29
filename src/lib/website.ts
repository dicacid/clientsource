/**
 * Shared website normalization rule. Mirrors public.normalize_website() in SQL.
 * Returns "https://host", null for empty input, or throws-free `invalid` marker via normalizeWebsiteResult.
 */
export type WebsiteResult = { ok: true; value: string | null } | { ok: false; error: string };

export function normalizeWebsiteResult(raw: string | null | undefined): WebsiteResult {
  if (raw == null) return { ok: true, value: null };
  let h = raw.trim();
  if (h === "") return { ok: true, value: null };
  h = h.toLowerCase();
  h = h.replace(/^https?:\/\//, "");
  h = h.replace(/^www\./, "");
  const cut = h.search(/[/?#]/);
  if (cut >= 0) h = h.slice(0, cut);
  h = h.replace(/\.$/, "");
  if (h === "" || !h.includes(".")) return { ok: false, error: "Website must be a domain like example.com" };
  return { ok: true, value: `https://${h}` };
}

export function normalizeWebsite(raw: string | null | undefined): string | null {
  const r = normalizeWebsiteResult(raw);
  return r.ok ? r.value : null;
}
