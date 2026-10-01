import { parseAustralianDate } from "./tender-core";

export type RawTender = {
  sourceName: string;
  sourceSpecificId: string | null;
  title: string;
  issuer: string | null;
  referenceNumber: string | null;
  canonicalSourceUrl: string;
  opportunityType: string | null;
  category: string | null;
  summary: string | null;
  publishedDate: string | null;
  closingDateTime: string | null;
  timezone: string;
  normalizedCloseTimestamp: string | null;
  country: string;
  state: string | null;
  location: string | null;
  documentedContractValue: string | null;
  tenderDocumentLinks: string[];
  sourceStatus: string;
  evidence: Array<{
    statement: string;
    sourceUrl: string | null;
    classification: "OBSERVED_FACT" | "SOURCE_CLAIM" | "UNKNOWN";
  }>;
};

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

export function htmlToPlainText(value: string): string {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|tr|li|h[1-6]|td|th)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function field(text: string, label: string, nextLabels: string[]): string | null {
  const escaped = escapeRegex(label);
  const next = nextLabels.map(escapeRegex).join("|");
  const regex = new RegExp(escaped + "\\s*:?\\s*([\\s\\S]*?)(?=" + (next ? next : "$") + ")", "i");
  const value = text.match(regex)?.[1]?.replace(/\s+/g, " ").trim();
  return value || null;
}

function absoluteVictoriaUrl(href: string): string {
  try { return new URL(href, "https://www.tenders.vic.gov.au").toString(); }
  catch { return href; }
}

export function parseVictoriaListHtml(html: string): RawTender[] {
  const results: RawTender[] = [];
  const linkRegex = /<a\b[^>]*href=["']([^"']*\/tender\/view\?id=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((match = linkRegex.exec(html))) {
    const href = absoluteVictoriaUrl(match[1]);
    if (seen.has(href)) continue;
    seen.add(href);
    const title = htmlToPlainText(match[2]).trim();
    if (!title) continue;
    const start = Math.max(0, match.index - 1800);
    const end = Math.min(html.length, match.index + 4300);
    const context = htmlToPlainText(html.slice(start, end));
    const titleIndex = context.toLowerCase().indexOf(title.toLowerCase());
    const before = titleIndex >= 0 ? context.slice(0, titleIndex) : context;
    const after = titleIndex >= 0 ? context.slice(titleIndex + title.length) : context;
    const referenceNumber = before.match(/([A-Z0-9][A-Z0-9./_-]{2,}(?:\s*[-/]\s*[A-Z0-9._-]+)?)\s+(?:Open|Closed)\s+(?:Request|Expression|Invitation|Notice|Tender)/i)?.[1]?.trim()
      ?? before.match(/(?:RFx|Tender|Reference|Number)\s*:?\s*([A-Z0-9][A-Z0-9./_-]{2,})/i)?.[1]?.trim()
      ?? null;
    const opportunityType = before.match(/(?:Open|Closed)\s+((?:Request|Expression|Invitation|Notice|Tender)[^\n]{0,90})$/i)?.[1]?.trim()
      ?? null;
    const issuer = after.match(/Issued by:\s*([\s\S]*?)(?=UNSPSC|Opened|Closing|$)/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
    const category = after.match(/UNSPSC\s*:?\s*([\s\S]*?)(?=Opened|Closing|$)/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
    const opened = after.match(/Opened\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\n]{0,70}?\d{4}(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))?)/i)?.[1]?.trim() ?? null;
    const closing = after.match(/Closing\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\n]{0,90}?\d{4}(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))?)/i)?.[1]?.trim() ?? null;
    const sourceSpecificId = new URL(href).searchParams.get("id");
    const evidence = [
      { statement: "Tender title listed by Tenders VIC: " + title, sourceUrl: href, classification: "OBSERVED_FACT" as const },
      ...(issuer ? [{ statement: "Issuer listed as " + issuer + ".", sourceUrl: href, classification: "OBSERVED_FACT" as const }] : []),
      ...(referenceNumber ? [{ statement: "Tender reference listed as " + referenceNumber + ".", sourceUrl: href, classification: "OBSERVED_FACT" as const }] : []),
      ...(closing ? [{ statement: "Closing date listed as " + closing + ".", sourceUrl: href, classification: "OBSERVED_FACT" as const }] : []),
    ];
    results.push({
      sourceName: "Tenders VIC",
      sourceSpecificId,
      title,
      issuer,
      referenceNumber,
      canonicalSourceUrl: href,
      opportunityType,
      category,
      summary: null,
      publishedDate: parseAustralianDate(opened, "Australia/Melbourne"),
      closingDateTime: closing,
      timezone: "Australia/Melbourne",
      normalizedCloseTimestamp: parseAustralianDate(closing, "Australia/Melbourne"),
      country: "Australia",
      state: "VIC",
      location: "Victoria",
      documentedContractValue: null,
      tenderDocumentLinks: [],
      sourceStatus: /closed/i.test(before) ? "closed" : "open",
      evidence,
    });
  }
  return results;
}

export function parseVictoriaDetailHtml(html: string, raw: RawTender): RawTender {
  const text = htmlToPlainText(html);
  const issuer = field(text, "Issued By", ["Type:", "Status:", "Number:", "Contract Number:", "UNSPSC:", "Region(s):"]) ?? raw.issuer;
  const type = field(text, "Type:", ["Status:", "Number:", "Contract Number:", "UNSPSC:", "Region(s):"]) ?? raw.opportunityType;
  const status = field(text, "Status:", ["Number:", "Contract Number:", "UNSPSC:", "Region(s):"]) ?? raw.sourceStatus;
  const number = field(text, "Number:", ["Contract Number:", "UNSPSC:", "Region(s):"]) ?? raw.referenceNumber;
  const category = field(text, "UNSPSC:", ["Region(s):", "Enquiries", "Description", "Tender Opening Date:"]) ?? raw.category;
  const region = field(text, "Region(s):", ["Enquiries", "Description", "Tender Opening Date:"]) ?? raw.location;
  const description = field(text, "Description", ["Tender Opening Date:", "Tender Closing Date:", "Forum"]) ?? raw.summary;
  const opened = field(text, "Tender Opening Date:", ["Tender Closing Date:", "Forum"]) ?? null;
  const closing = field(text, "Tender Closing Date:", ["Forum", "Online Forum", "Site Visit", "Documents"]) ?? raw.closingDateTime;

  const docs: string[] = [];
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(html))) {
    const label = htmlToPlainText(linkMatch[2]);
    if (!/document|attachment|download|addendum|brief|specification|schedule/i.test(label + " " + linkMatch[1])) continue;
    try { docs.push(new URL(linkMatch[1], raw.canonicalSourceUrl).toString()); } catch { /* ignore malformed */ }
  }

  const evidence = [
    ...raw.evidence,
    ...(description ? [{ statement: "Official tender description: " + description.slice(0, 1000), sourceUrl: raw.canonicalSourceUrl, classification: "SOURCE_CLAIM" as const }] : []),
    ...(region ? [{ statement: "Official source lists region as " + region + ".", sourceUrl: raw.canonicalSourceUrl, classification: "OBSERVED_FACT" as const }] : []),
  ];

  return {
    ...raw,
    issuer,
    opportunityType: type,
    sourceStatus: status,
    referenceNumber: number,
    category,
    location: region,
    summary: description,
    publishedDate: parseAustralianDate(opened, "Australia/Melbourne") ?? raw.publishedDate,
    closingDateTime: closing,
    normalizedCloseTimestamp: parseAustralianDate(closing, "Australia/Melbourne") ?? raw.normalizedCloseTimestamp,
    tenderDocumentLinks: [...new Set([...raw.tenderDocumentLinks, ...docs])],
    evidence,
  };
}

function xmlValue(item: string, tag: string): string | null {
  const regex = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + tag + ">", "i");
  const value = item.match(regex)?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "");
  return value ? htmlToPlainText(value) : null;
}

export function parseAusTenderRss(xml: string): RawTender[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  return items.flatMap((item) => {
    const title = xmlValue(item, "title");
    const link = xmlValue(item, "link") || xmlValue(item, "guid");
    if (!title || !link || !/^https?:\/\//i.test(link)) return [];
    const description = xmlValue(item, "description");
    const pubDate = xmlValue(item, "pubDate");
    const reference = description?.match(/(?:ATM ID|Reference|Tender ID)\s*:?\s*([A-Z0-9._/-]+)/i)?.[1] ?? null;
    const closing = description?.match(/(?:Close(?:s|d)?|Closing Date)\s*:?\s*([^.;\n]{6,80})/i)?.[1] ?? null;
    let publishedDate: string | null = null;
    if (pubDate) {
      const date = new Date(pubDate);
      if (!Number.isNaN(date.getTime())) publishedDate = date.toISOString();
    }
    return [{
      sourceName: "AusTender",
      sourceSpecificId: reference,
      title,
      issuer: description?.match(/(?:Agency|Organisation)\s*:?\s*([^.;\n]{2,160})/i)?.[1]?.trim() ?? null,
      referenceNumber: reference,
      canonicalSourceUrl: link,
      opportunityType: "Australian Government procurement",
      category: xmlValue(item, "category"),
      summary: description,
      publishedDate,
      closingDateTime: closing,
      timezone: "Australia/Sydney",
      normalizedCloseTimestamp: parseAustralianDate(closing, "Australia/Sydney"),
      country: "Australia",
      state: null,
      location: "Australia",
      documentedContractValue: null,
      tenderDocumentLinks: [],
      sourceStatus: "open",
      evidence: [
        { statement: "Opportunity title published in the official AusTender feed: " + title, sourceUrl: link, classification: "OBSERVED_FACT" as const },
      ],
    }];
  });
}

export function parseNswOpportunityHtml(html: string): RawTender[] {
  const results: RawTender[] = [];
  const regex = /<a\b[^>]*href=["']([^"']*(?:opportunity|tender)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    let href: string;
    try { href = new URL(match[1], "https://buy.nsw.gov.au").toString(); } catch { continue; }
    if (!/buy\.nsw\.gov\.au/i.test(href) || seen.has(href)) continue;
    const title = htmlToPlainText(match[2]).replace(/\s+/g, " ").trim();
    if (title.length < 6 || (/search|login|opportunities|tenders/i.test(title) && title.length < 30)) continue;
    seen.add(href);
    const context = htmlToPlainText(html.slice(Math.max(0, match.index - 1200), Math.min(html.length, match.index + 2600)));
    const reference = context.match(/(?:Reference|Opportunity ID|Tender ID)\s*:?\s*([A-Z0-9._/-]{3,})/i)?.[1] ?? null;
    const issuer = context.match(/(?:Agency|Buyer|Organisation|Department)\s*:?\s*([^\n]{3,160})/i)?.[1]?.trim() ?? null;
    const closing = context.match(/(?:Close(?:s|d)?|Closing(?: date)?)\s*:?\s*((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?[^\n]{4,80}\d{4}(?:[^\n]{0,20}(?:am|pm))?)/i)?.[1]?.trim() ?? null;
    const id = new URL(href).searchParams.get("id") || href.split("/").filter(Boolean).pop() || reference;
    results.push({
      sourceName: "NSW Opportunities Hub",
      sourceSpecificId: id,
      title,
      issuer,
      referenceNumber: reference,
      canonicalSourceUrl: href,
      opportunityType: "NSW Government procurement",
      category: null,
      summary: null,
      publishedDate: null,
      closingDateTime: closing,
      timezone: "Australia/Sydney",
      normalizedCloseTimestamp: parseAustralianDate(closing, "Australia/Sydney"),
      country: "Australia",
      state: "NSW",
      location: "New South Wales",
      documentedContractValue: null,
      tenderDocumentLinks: [],
      sourceStatus: "open",
      evidence: [
        { statement: "Opportunity listed on the NSW Government Opportunities Hub: " + title, sourceUrl: href, classification: "OBSERVED_FACT" as const },
      ],
    });
  }
  return results;
}
