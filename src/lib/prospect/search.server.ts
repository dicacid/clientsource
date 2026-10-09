// Public Bing RSS results provide source links without asking the operator for a website.
// Search can be unavailable or incomplete; never treat an empty response as evidence that a business has no website.
export type SearchHit = { title: string; url: string; snippet: string };

function decodeXml(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function parseBingRss(xml: string): SearchHit[] {
  const results: SearchHit[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1] ?? "";
    const field = (name: string) => decodeXml(item.match(new RegExp("<" + name + "\\b[^>]*>([\\s\\S]*?)<\\/" + name + ">", "i"))?.[1] ?? "");
    const title = field("title").slice(0, 250);
    const rawUrl = field("link");
    const snippet = field("description").slice(0, 850);
    try {
      const url = new URL(rawUrl);
      if (!["http:", "https:"].includes(url.protocol) || !title) continue;
      if (url.username || url.password || url.hostname.endsWith(".bing.com")) continue;
      results.push({ title, url: url.toString(), snippet });
    } catch {
      // Ignore malformed search listings.
    }
  }
  return results.slice(0, 12);
}

export async function searchPublicWeb(query: string): Promise<SearchHit[]> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8500);
  try {
    const url = "https://www.bing.com/search?q=" + encodeURIComponent(query.slice(0, 400)) + "&format=rss";
    const response = await fetch(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": "Mozilla/5.0 (compatible; ProspectFinderB2B/1.0)" },
      signal: ctrl.signal,
    });
    if (!response.ok) return [];
    return parseBingRss((await response.text()).slice(0, 180000));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
