import {
  parseAusTenderRss,
  parseNswOpportunityHtml,
  parseVictoriaDetailHtml,
  parseVictoriaListHtml,
  type RawTender,
} from "./tender-source-parsers";

export type TenderSourceResult = {
  source: string;
  status: "success" | "failed";
  records: RawTender[];
  error: string | null;
  durationMs: number;
};

export type TenderSourceAdapter = {
  id: string;
  name: string;
  officialUrl: string;
  retrieve: () => Promise<RawTender[]>;
  verify: (record: RawTender) => Promise<RawTender>;
};

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "SPA-Intelligence/1.0 (+https://spa-intelligence.onrender.com)",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error("Network retrieval failed for " + url + ": " + (error instanceof Error ? error.message : String(error)));
  }
  if (!response.ok) {
    throw new Error("Official source returned HTTP " + response.status + " for " + url + ".");
  }
  return response.text();
}

async function retrieveVictoria(): Promise<RawTender[]> {
  const pages = [
    "https://www.tenders.vic.gov.au/tenders/open",
    "https://www.tenders.vic.gov.au/tenders/open?page=2",
    "https://www.tenders.vic.gov.au/tenders/open?page=3",
  ];
  const all: RawTender[] = [];
  for (const url of pages) {
    const html = await fetchText(url);
    const rows = parseVictoriaListHtml(html);
    if (!rows.length && !all.length) {
      throw new Error("Tenders VIC was retrieved but no tender records could be parsed from the current page.");
    }
    all.push(...rows);
    if (rows.length < 5) break;
  }
  const seen = new Set<string>();
  return all.filter((row) => {
    const key = row.sourceSpecificId || row.canonicalSourceUrl;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 150);
}

async function verifyVictoria(record: RawTender): Promise<RawTender> {
  const html = await fetchText(record.canonicalSourceUrl, 12000);
  return parseVictoriaDetailHtml(html, record);
}

async function retrieveAusTender(): Promise<RawTender[]> {
  const url = "https://www.tenders.gov.au/public_data/rss/rss.xml";
  const xml = await fetchText(url);
  const rows = parseAusTenderRss(xml);
  if (!rows.length) {
    throw new Error("AusTender RSS was retrieved but no tender records could be parsed.");
  }
  return rows.slice(0, 200);
}

async function retrieveNsw(): Promise<RawTender[]> {
  const url = "https://buy.nsw.gov.au/opportunity/search?types=Tenders";
  const html = await fetchText(url);
  const rows = parseNswOpportunityHtml(html);
  if (!rows.length) {
    throw new Error("NSW Opportunities Hub was retrieved but no tender records could be parsed from the public response.");
  }
  return rows.slice(0, 150);
}

async function passthrough(record: RawTender) {
  return record;
}

export const TENDER_SOURCE_ADAPTERS: TenderSourceAdapter[] = [
  {
    id: "tenders-vic",
    name: "Tenders VIC",
    officialUrl: "https://www.tenders.vic.gov.au/tenders/open",
    retrieve: retrieveVictoria,
    verify: verifyVictoria,
  },
  {
    id: "austender",
    name: "AusTender",
    officialUrl: "https://www.tenders.gov.au/public_data/rss/rss.xml",
    retrieve: retrieveAusTender,
    verify: passthrough,
  },
  {
    id: "nsw-opportunities",
    name: "NSW Opportunities Hub",
    officialUrl: "https://buy.nsw.gov.au/opportunity/search?types=Tenders",
    retrieve: retrieveNsw,
    verify: passthrough,
  },
];

export async function retrieveTenderSource(adapter: TenderSourceAdapter): Promise<TenderSourceResult> {
  const started = Date.now();
  try {
    const records = await adapter.retrieve();
    return {
      source: adapter.name,
      status: "success",
      records,
      error: null,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      source: adapter.name,
      status: "failed",
      records: [],
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
}

export async function tenderSourceHealth() {
  const results: Array<{
    source: string;
    officialUrl: string;
    status: "success" | "failed";
    count: number;
    error: string | null;
    durationMs: number;
  }> = [];
  for (const adapter of TENDER_SOURCE_ADAPTERS) {
    const result = await retrieveTenderSource(adapter);
    results.push({
      source: adapter.name,
      officialUrl: adapter.officialUrl,
      status: result.status,
      count: result.records.length,
      error: result.error,
      durationMs: result.durationMs,
    });
  }
  return {
    checkedAt: new Date().toISOString(),
    sources: results,
    overall: results.some((x) => x.status === "success") ? (results.every((x) => x.status === "success") ? "success" : "partial") : "failed",
  };
}
