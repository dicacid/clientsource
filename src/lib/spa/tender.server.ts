import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { getAiRuntime } from "./openrouter.server";
import { requestJsonResponse } from "./json-response.server";
import {
  businessRouting,
  canonicalUrl,
  classifyClosing,
  deterministicTenderKey,
  highRelevance,
  isOfficialAustralianProcurementUrl,
  parseAustralianLocalDate,
  parseConsolidatedTenderText,
  parseNswOpportunityText,
  scoreTender,
  secondaryTenderKey,
  type RawTender,
  type TenderBusinessContext,
  type TenderEvidence,
  type TenderRecord,
  type TenderWorkflowStatus,
} from "./tenders";

type SourceAttempt = {
  sourceId: string;
  sourceName: string;
  status: "success" | "failed" | "limited";
  retrieved: number;
  error: string | null;
  durationMs: number;
};

export type TenderScanRun = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  state: "running" | "success" | "partial" | "failed";
  stage: "Starting" | "Checking sources" | "Retrieving opportunities" | "Verifying" | "Deduplicating" | "Analysing relevance" | "Saving" | "Complete";
  sourcesAttempted: number;
  sourceSuccesses: number;
  sourceFailures: number;
  sourceAttempts: SourceAttempt[];
  opportunitiesDiscovered: number;
  duplicatesRemoved: number;
  newTenders: number;
  updatedTenders: number;
  unchangedTenders: number;
  aiEnrichments: number;
  selectedModel: string | null;
  errors: string[];
};

type TenderStore = {
  records: TenderRecord[];
  audits: TenderScanRun[];
  currentScan: TenderScanRun | null;
};

type TenderSourceAdapter = {
  id: string;
  name: string;
  retrieve: () => Promise<RawTender[]>;
};

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

const storeKey = (orgId: string) => `spa-intelligence:tenders:v1:${orgId}`;

async function redis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;
  if (!connectPromise) {
    const url = process.env["REDIS_URL"];
    if (!url) throw new Error("REDIS_URL is not configured.");
    const next = createClient({ url });
    next.on("error", (error) => console.error("[SPA Intelligence tender store]", error));
    connectPromise = next.connect().then(() => {
      client = next as RedisClientType;
      return client;
    });
  }
  return connectPromise;
}

function emptyStore(): TenderStore {
  return { records: [], audits: [], currentScan: null };
}

async function readStore(orgId: string): Promise<TenderStore> {
  const r = await redis();
  const raw = await r.get(storeKey(orgId));
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as Partial<TenderStore>;
    return {
      records: Array.isArray(parsed.records) ? parsed.records : [],
      audits: Array.isArray(parsed.audits) ? parsed.audits : [],
      currentScan: parsed.currentScan ?? null,
    };
  } catch {
    throw new Error("Tender Intelligence datastore is unreadable.");
  }
}

async function writeStore(orgId: string, value: TenderStore) {
  const r = await redis();
  await r.set(storeKey(orgId), JSON.stringify({
    records: value.records.slice(0, 1500),
    audits: value.audits.slice(0, 50),
    currentScan: value.currentScan,
  }));
}

async function mutateStore<T>(orgId: string, fn: (store: TenderStore) => Promise<T> | T): Promise<T> {
  let resolveRun!: (value: T | PromiseLike<T>) => void;
  let rejectRun!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => { resolveRun = resolve; rejectRun = reject; });
  const previous = writeQueue;
  writeQueue = previous.catch(() => undefined).then(async () => {
    try {
      const store = await readStore(orgId);
      const value = await fn(store);
      await writeStore(orgId, store);
      resolveRun(value);
    } catch (error) {
      rejectRun(error);
    }
  });
  return result;
}

function decodeHtml(input: string) {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlLines(input: string) {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function parseVictoriaPage(html: string, page: number): RawTender[] {
  return parseConsolidatedTenderText(decodeHtml(html), {
    sourceName: "Buying for Victoria",
    sourceUrl: `https://www.tenders.vic.gov.au/tenders/open?page=${page}`,
    timezone: "Australia/Melbourne",
    state: "VIC",
    location: "Victoria",
  });
}

async function fetchedText(url: string, timeout = 15000) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "SPA-Intelligence-Tender-Monitor/1.0 (+https://spa-intelligence.onrender.com)",
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.text();
}

async function fetchedJson<T>(url: string, timeout = 12000): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "SPA-Intelligence-Tender-Monitor/1.0 (+https://spa-intelligence.onrender.com)",
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json() as Promise<T>;
}

const townsvilleAdapter: TenderSourceAdapter = {
  id: "townsville-council-data",
  name: "Townsville City Council Open Data",
  async retrieve() {
    const resourceId = "3d8af8cc-9450-4079-ad23-2fbdbc1f6488";
    const sourceUrl = "https://data.gov.au/data/dataset/townsville-city-council-tender-activities";
    const apiUrl = "https://data.gov.au/data/api/3/action/datastore_search?resource_id=" +
      resourceId + "&limit=100&filters=%7B%22Status%22%3A%22Open%22%7D";
    type TownsvilleRow = {
      "_id"?: number;
      "RFx No"?: string;
      "Tender Type"?: string;
      "Notice Type"?: string;
      "Status"?: string;
      "Summary"?: string;
      "Release Date"?: string;
      "Closed Date/Time"?: string;
    };
    const payload = await fetchedJson<{ success?: boolean; result?: { records?: TownsvilleRow[] } }>(apiUrl);
    if (!payload.success) throw new Error("data.gov.au returned an unsuccessful CKAN response.");
    const records = payload.result?.records ?? [];
    return records.flatMap((row) => {
      const reference = String(row["RFx No"] ?? "").trim();
      const title = String(row["Summary"] ?? "").trim();
      if (!reference || !title) return [];
      return [{
        sourceName: "Townsville City Council Open Data",
        sourceSpecificId: reference,
        sourceUrl: datasetUrl,
        tenderTitle: title.slice(0, 500),
        issuer: "Townsville City Council",
        referenceNumber: reference,
        opportunityType: String(row["Notice Type"] ?? row["Tender Type"] ?? "Tender").trim(),
        category: String(row["Tender Type"] ?? "").trim() || null,
        summary: title,
        publishedDateRaw: String(row["Release Date"] ?? "").trim() || null,
        closingDateRaw: String(row["Closed Date/Time"] ?? "").trim() || null,
        timezone: "Australia/Brisbane",
        country: "Australia",
        state: "QLD",
        location: "Townsville, Queensland",
        documentedContractValue: null,
        tenderDocumentLinks: [],
        sourceStatus: "open" as const,
      }];
    });
  },
};

const queenslandForwardProcurementAdapter: TenderSourceAdapter = {
  id: "qld-forward-procurement",
  name: "Queensland Government Forward Procurement Pipeline",
  async retrieve() {
    const resourceId = "d3968658-dbb7-4732-bc19-467c49de23de";
    const datasetUrl = "https://www.data.qld.gov.au/dataset/forward-procurement-pipeline/resource/" + resourceId;
    const apiUrl = "https://www.data.qld.gov.au/api/3/action/datastore_search?resource_id=" +
      resourceId + "&limit=1000";

    type QldForwardRow = {
      "_id"?: number;
      "Agency"?: string;
      "Business Unit"?: string | null;
      "Category Group"?: string | null;
      "Category"?: string | null;
      "Program Description"?: string;
      "Estimated Timing for Release to Market"?: string | null;
      "Procurement Method"?: string | null;
      "Spend Range"?: string | null;
      "Funding Status"?: string | null;
      "Region SA4"?: string | null;
      "Agency Region"?: string | null;
      "Link"?: string | null;
      "Brisbane 2032 related"?: string | null;
    };

    const payload = await fetchedJson<{ success?: boolean; result?: { records?: QldForwardRow[] } }>(apiUrl, 18000);
    if (!payload.success) throw new Error("Queensland open-data portal returned an unsuccessful CKAN response.");

    const relevant = /\b(?:solar|photovoltaic|\bpv\b|battery|\bbess\b|energy storage|renewable|microgrid|off[- ]grid|hybrid power|electric(?:al|ity)?|power (?:system|supply|infrastructure|station|generation)|generator|substation|transformer|switchboard|high voltage|low voltage|ev charging|electric vehicle|electrification|charging infrastructure|lithium|inverter|decarboni[sz]|distributed energy|hydrogen)\b/i;
    const records = payload.result?.records ?? [];

    return records.flatMap((row) => {
      const title = String(row["Program Description"] ?? "").trim();
      const issuer = String(row["Agency"] ?? "").trim();
      if (!title || !issuer) return [];

      const relevanceText = [
        title,
        row["Category Group"],
        row["Category"],
        row["Business Unit"],
      ].filter(Boolean).join(" ");
      if (!relevant.test(relevanceText)) return [];

      const rowId = Number(row["_id"]);
      if (!Number.isFinite(rowId)) return [];

      const method = String(row["Procurement Method"] ?? "").trim();
      const timing = String(row["Estimated Timing for Release to Market"] ?? "").trim();
      const spend = String(row["Spend Range"] ?? "").trim();
      const funding = String(row["Funding Status"] ?? "").trim();
      const region = String(row["Region SA4"] ?? row["Agency Region"] ?? "").trim();
      const categoryGroup = String(row["Category Group"] ?? "").trim();
      const category = String(row["Category"] ?? "").trim();
      const publishedLink = String(row["Link"] ?? "").trim();
      const verifiedLinks = isOfficialAustralianProcurementUrl(publishedLink) ? [publishedLink] : [];

      const summaryParts = [
        categoryGroup ? `Category group: ${categoryGroup}.` : "",
        category ? `Category: ${category}.` : "",
        timing ? `Estimated release to market: ${timing}.` : "",
        method ? `Procurement method: ${method}.` : "",
        spend ? `Published estimated spend range: ${spend}.` : "",
        funding ? `Funding status: ${funding}.` : "",
      ].filter(Boolean);

      return [{
        sourceName: "Queensland Government Forward Procurement Pipeline",
        sourceSpecificId: `qld-fpp-${rowId}`,
        sourceUrl,
        tenderTitle: title.slice(0, 500),
        issuer: issuer.slice(0, 240),
        referenceNumber: null,
        opportunityType: method ? `Forward procurement · ${method}` : "Forward procurement",
        category: [categoryGroup, category].filter(Boolean).join(" · ").slice(0, 500) || null,
        summary: summaryParts.join(" ").slice(0, 2000) || null,
        publishedDateRaw: null,
        closingDateRaw: null,
        timezone: "Australia/Brisbane",
        country: "Australia",
        state: "QLD",
        location: region ? `${region}, Queensland` : "Queensland",
        documentedContractValue: null,
        tenderDocumentLinks: verifiedLinks,
        sourceStatus: "unknown" as const,
      }];
    });
  },
};

const victoriaAdapter: TenderSourceAdapter = {
  id: "buying-for-victoria",
  name: "Buying for Victoria",
  async retrieve() {
    const pages = await Promise.all([1, 2, 3].map(async (page) => {
      const html = await fetchedText(`https://www.tenders.vic.gov.au/tenders/open?page=${page}`);
      return parseVictoriaPage(html, page);
    }));
    const rows = pages.flat();
    if (!rows.length) throw new Error("Official Victoria page was reachable but no tender records matched the current parser.");
    return rows;
  },
};

const actAdapter: TenderSourceAdapter = {
  id: "tenders-act",
  name: "Tenders ACT",
  async retrieve() {
    const url = "https://www.tenders.act.gov.au/tenders/open";
    const html = await fetchedText(url, 12000);
    const rows = parseConsolidatedTenderText(decodeHtml(html), {
      sourceName: "Tenders ACT",
      sourceUrl: url,
      timezone: "Australia/Sydney",
      state: "ACT",
      location: "Australian Capital Territory",
    });
    if (!rows.length) throw new Error("Official ACT page was reachable but no tender records matched the current parser.");
    return rows;
  },
};

const nswAdapter: TenderSourceAdapter = {
  id: "buy-nsw",
  name: "buy.nsw Opportunities Hub",
  async retrieve() {
    const firstUrl = "https://buy.nsw.gov.au/opportunity/search?types=Tenders&page=0";
    const firstHtml = await fetchedText(firstUrl, 15000);
    const firstText = decodeHtmlLines(firstHtml);
    const firstRows = parseNswOpportunityText(firstText, firstUrl);

    const totalMatch = firstText.match(/Displaying\s+\d+\s*-\s*\d+\s+of\s+(\d+)\s+results/i);
    const total = totalMatch ? Number(totalMatch[1]) : firstRows.length;
    const pageCount = Math.max(1, Math.min(15, Math.ceil((Number.isFinite(total) ? total : firstRows.length) / 10)));

    const rows = [...firstRows];
    for (let page = 1; page < pageCount; page += 4) {
      const batch = Array.from({ length: Math.min(4, pageCount - page) }, (_, offset) => page + offset);
      const results = await Promise.allSettled(batch.map(async (pageNumber) => {
        const url = `https://buy.nsw.gov.au/opportunity/search?types=Tenders&page=${pageNumber}`;
        const html = await fetchedText(url, 15000);
        return parseNswOpportunityText(decodeHtmlLines(html), url);
      }));
      for (const result of results) {
        if (result.status === "fulfilled") rows.push(...result.value);
      }
    }

    const unique = new Map<string, RawTender>();
    for (const row of rows) unique.set(row.sourceSpecificId, row);
    const result = [...unique.values()];
    if (!result.length) throw new Error("NSW opportunity index is currently not reliably machine-retrievable from the Render runtime.");
    return result;
  },
};

const ausTenderAdapter: TenderSourceAdapter = {
  id: "austender",
  name: "AusTender",
  async retrieve() {
    const url = "https://www.tenders.gov.au/?event=public.ATM.list";
    const html = await fetchedText(url, 12000);
    const text = decodeHtml(html);
    if (/access denied|forbidden|captcha/i.test(text)) throw new Error("AusTender blocked automated retrieval.");
    throw new Error("AusTender public ATM page is reachable, but no stable public feed/parser has been verified for this runtime yet.");
  },
};

const ADAPTERS: TenderSourceAdapter[] = [townsvilleAdapter, queenslandForwardProcurementAdapter, victoriaAdapter, actAdapter, nswAdapter, ausTenderAdapter];

function officialSourceName(sourceUrl: string) {
  const host = new URL(sourceUrl).hostname.toLowerCase();
  if (host === "buy.nsw.gov.au") return "buy.nsw Opportunities Hub";
  if (host.endsWith("tenders.vic.gov.au")) return "Buying for Victoria";
  if (host.endsWith("tenders.act.gov.au")) return "Tenders ACT";
  if (host === "tenders.gov.au" || host === "www.tenders.gov.au") return "AusTender";
  if (host.endsWith("qtenders.epw.qld.gov.au")) return "QTenders";
  if (host.endsWith("tenders.sa.gov.au")) return "SA Tenders & Contracts";
  if (host.endsWith("tenders.wa.gov.au")) return "Tenders WA";
  if (host.endsWith("tenders.tas.gov.au")) return "Tasmanian Government Tenders";
  if (host === "tendersonline.nt.gov.au") return "NT Quotations and Tenders Online";
  if (host.endsWith("data.gov.au")) return "Data.gov.au procurement data";
  return "Official Australian procurement source";
}

async function officialWebSearchFallback(orgId: string, failedSources: string[]) {
  const runtime = await getAiRuntime(orgId);
  type Result = {
    opportunities: Array<{
      title: string;
      issuer: string;
      reference: string | null;
      source_url: string;
      opportunity_type: string | null;
      category: string | null;
      summary: string | null;
      published_date: string | null;
      closing_date: string | null;
      timezone: string | null;
      state: string | null;
      location: string | null;
      documented_contract_value: string | null;
      document_links: string[];
    }>;
  };

  const today = new Date().toISOString().slice(0, 10);
  const response = await requestJsonResponse<Result>({
    ...runtime,
    effort: "low",
    tools: [{
      type: "openrouter:web_search",
      parameters: {
        engine: "parallel",
        max_results: 8,
        max_total_results: 16,
        search_context_size: "medium",
      },
    }],
    system: `You are the fallback discovery layer for SPA Intelligence's Australian procurement monitor.
Direct HTTP access to some official tender portals is blocked from the application runtime, so use current web search to recover only evidence that is indexed from official Australian procurement sources.
Never invent an opportunity, reference, issuer, closing date, requirement, value or document.
Only return currently open opportunities whose source_url is an official procurement URL on one of these hosts:
buy.nsw.gov.au, tenders.vic.gov.au, tenders.act.gov.au, tenders.gov.au, qtenders.epw.qld.gov.au, tenders.sa.gov.au, tenders.wa.gov.au, tenders.tas.gov.au, tendersonline.nt.gov.au, data.gov.au.
Prefer exact opportunity/detail pages over generic search pages.
If a field is not supported by the indexed official material, return null rather than guessing.`,
    user: `Today is ${today}. Direct retrieval failed or was limited for: ${failedSources.join(", ")}.

Search current official Australian procurement material for OPEN opportunities relevant to one or more of:
- commercial or industrial solar PV
- batteries, BESS and energy storage
- microgrids, hybrid power, off-grid power and remote power
- electrical infrastructure, power systems, generators and energy systems
- EV charging, electric vehicles and electrification
- lithium battery systems and specialist battery supply
- renewable-energy equipment supply, solar panels, inverters and chargers
- remote monitoring, mining/resources site power and relocatable power
- specialist electrical/energy engineering, prototyping or R&D

Return JSON {"opportunities":[...]} with at most 20 high-signal opportunities.
Each opportunity must include title, issuer and source_url.
Include reference and closing_date whenever shown by the official source.
Use Australian state abbreviations where supported.
Do not return closed, awarded or expired opportunities.
Do not use news articles, tender aggregators, LinkedIn, directories, supplier sites or inferred opportunities.`,
  });

  const rows: RawTender[] = [];
  for (const item of response.data.opportunities ?? []) {
    const sourceUrl = String(item.source_url ?? "").trim();
    const title = String(item.title ?? "").trim();
    const issuer = String(item.issuer ?? "").trim();
    if (!title || !issuer || !isOfficialAustralianProcurementUrl(sourceUrl)) continue;

    const reference = item.reference ? String(item.reference).trim().slice(0, 120) : null;
    const sourceSpecificId = reference || canonicalUrl(sourceUrl);
    const state = item.state ? String(item.state).trim().toUpperCase().slice(0, 10) : null;
    const timezone =
      item.timezone ? String(item.timezone).trim().slice(0, 80)
      : state === "QLD" ? "Australia/Brisbane"
      : state === "SA" ? "Australia/Adelaide"
      : state === "WA" ? "Australia/Perth"
      : state === "NT" ? "Australia/Darwin"
      : state === "TAS" ? "Australia/Hobart"
      : "Australia/Sydney";

    rows.push({
      sourceName: officialSourceName(sourceUrl),
      sourceSpecificId,
      sourceUrl,
      tenderTitle: title.slice(0, 500),
      issuer: issuer.slice(0, 240),
      referenceNumber: reference,
      opportunityType: String(item.opportunity_type ?? "Tender").trim().slice(0, 120),
      category: item.category ? String(item.category).trim().slice(0, 500) : null,
      summary: item.summary ? String(item.summary).trim().slice(0, 2000) : null,
      publishedDateRaw: item.published_date ? String(item.published_date).trim().slice(0, 120) : null,
      closingDateRaw: item.closing_date ? String(item.closing_date).trim().slice(0, 120) : null,
      timezone,
      country: "Australia",
      state,
      location: item.location ? String(item.location).trim().slice(0, 240) : state,
      documentedContractValue: item.documented_contract_value ? String(item.documented_contract_value).trim().slice(0, 240) : null,
      tenderDocumentLinks: Array.isArray(item.document_links)
        ? item.document_links.map(String).map((url) => url.trim()).filter(isOfficialAustralianProcurementUrl).slice(0, 12)
        : [],
      sourceStatus: "open",
      retrievalMethod: "search",
    });
  }

  return { rows, modelUsed: response.modelUsed };
}

export async function tenderSourceHealth() {
  const sources: Array<{
    sourceId: string;
    sourceName: string;
    status: "success" | "failed" | "limited";
    retrieved: number;
    error: string | null;
    durationMs: number;
  }> = [];

  for (const adapter of ADAPTERS) {
    const started = Date.now();
    try {
      const rows = await adapter.retrieve();
      sources.push({
        sourceId: adapter.id,
        sourceName: adapter.name,
        status: "success",
        retrieved: rows.length,
        error: null,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sources.push({
        sourceId: adapter.id,
        sourceName: adapter.name,
        status: /parser|reliably|stable public feed/i.test(message) ? "limited" : "failed",
        retrieved: 0,
        error: message,
        durationMs: Date.now() - started,
      });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    state: sources.some((source) => source.status === "success")
      ? (sources.every((source) => source.status === "success") ? "success" : "partial")
      : "failed",
    sources,
  };
}

function normalizeRaw(raw: RawTender, now: string): TenderRecord {
  const closeTimestamp = raw.closingDateRaw?.includes("T")
    ? (Number.isFinite(Date.parse(raw.closingDateRaw)) ? new Date(raw.closingDateRaw).toISOString() : null)
    : parseAustralianLocalDate(raw.closingDateRaw, raw.timezone ?? "Australia/Sydney");
  const published = raw.publishedDateRaw
    ? (raw.publishedDateRaw.includes("T")
      ? (Number.isFinite(Date.parse(raw.publishedDateRaw)) ? new Date(raw.publishedDateRaw).toISOString() : null)
      : parseAustralianLocalDate(raw.publishedDateRaw, raw.timezone ?? "Australia/Sydney"))
    : null;
  const sourceClassification: TenderEvidence["classification"] =
    raw.retrievalMethod === "search" ? "SOURCE_CLAIM" : "OBSERVED_FACT";
  const evidence: TenderEvidence[] = [
    { statement: `Tender title: ${raw.tenderTitle}`, sourceUrl: raw.sourceUrl, classification: sourceClassification },
    { statement: `Issuer: ${raw.issuer}`, sourceUrl: raw.sourceUrl, classification: sourceClassification },
  ];
  if (raw.referenceNumber) evidence.push({ statement: `Reference: ${raw.referenceNumber}`, sourceUrl: raw.sourceUrl, classification: sourceClassification });
  if (raw.closingDateRaw) evidence.push({ statement: `Closing date published as ${raw.closingDateRaw}`, sourceUrl: raw.sourceUrl, classification: sourceClassification });
  if (raw.retrievalMethod === "search") {
    evidence.push({
      statement: "Opportunity metadata was recovered from indexed official procurement material because direct retrieval from the source portal was unavailable from the application runtime.",
      sourceUrl: raw.sourceUrl,
      classification: "SOURCE_CLAIM",
    });
  }

  const routingText = [raw.tenderTitle, raw.summary, raw.category, raw.opportunityType, raw.issuer].filter(Boolean).join(" ");
  const businessFits = businessRouting(routingText);
  const assignedBusinessContexts = businessFits.filter((fit) => fit.score >= 20).map((fit) => fit.business);
  const capabilityMatches = [...new Set(businessFits.flatMap((fit) => fit.matchedCapabilities))];
  const scoring = scoreTender({
    title: raw.tenderTitle,
    summary: raw.summary,
    category: raw.category,
    state: raw.state,
    sourceName: raw.sourceName,
    sourceStatus: raw.sourceStatus,
    normalizedCloseTimestamp: closeTimestamp,
    businessFits,
    evidenceCount: evidence.length,
  });

  return {
    id: randomUUID(),
    tenderTitle: raw.tenderTitle,
    issuer: raw.issuer,
    referenceNumber: raw.referenceNumber,
    canonicalSourceUrl: canonicalUrl(raw.sourceUrl),
    sourceName: raw.sourceName,
    sourceSpecificId: raw.sourceSpecificId,
    opportunityType: raw.opportunityType,
    category: raw.category,
    summary: raw.summary,
    publishedDate: published,
    closingDateTime: raw.closingDateRaw,
    timezone: raw.timezone,
    normalizedCloseTimestamp: closeTimestamp,
    country: raw.country,
    state: raw.state,
    location: raw.location,
    documentedContractValue: raw.documentedContractValue,
    tenderDocumentLinks: [...new Set(raw.tenderDocumentLinks.map(canonicalUrl))],
    firstDiscovered: now,
    lastChecked: now,
    sourceStatus: raw.sourceStatus,
    workflowStatus: classifyClosing(closeTimestamp) === "expired" ? "Expired" : "New",
    assignedBusinessContexts,
    relevanceScore: scoring.score,
    relevanceExplanation: scoring.explanation,
    scoreFactors: scoring.factors,
    businessFits,
    capabilityMatches,
    evidence,
    risksUnknowns: [
      ...(raw.documentedContractValue ? [] : ["Contract value is not published in the retrieved evidence."]),
      ...(raw.tenderDocumentLinks.length ? [] : ["Tender documents were not retrieved from the public index and should be reviewed at source."]),
      ...(raw.retrievalMethod === "search"
        ? ["This record was recovered through indexed official-source search because direct source retrieval was blocked; confirm the live official notice before committing bid effort."]
        : []),
    ],
    commercialHypotheses: [],
    questionsToAsk: [],
    suggestedNextAction: scoring.score >= 65
      ? "Review the official tender page and documents, confirm scope and eligibility, then decide whether to pursue."
      : scoring.score >= 40
        ? "Review scope before committing bid effort."
        : "Monitor unless new evidence materially improves business fit.",
    notes: "",
    sourceHistory: [{
      sourceName: raw.sourceName,
      sourceSpecificId: raw.sourceSpecificId,
      sourceUrl: raw.sourceUrl,
      firstSeenAt: now,
      lastSeenAt: now,
    }],
    materialChangeHistory: [],
    enrichmentModel: null,
    enrichedAt: null,
  };
}

function sameMaterial(a: TenderRecord, b: TenderRecord) {
  return JSON.stringify({
    title: a.tenderTitle,
    issuer: a.issuer,
    type: a.opportunityType,
    category: a.category,
    summary: a.summary,
    close: a.normalizedCloseTimestamp,
    status: a.sourceStatus,
    location: a.location,
    docs: [...a.tenderDocumentLinks].sort(),
    value: a.documentedContractValue,
  }) === JSON.stringify({
    title: b.tenderTitle,
    issuer: b.issuer,
    type: b.opportunityType,
    category: b.category,
    summary: b.summary,
    close: b.normalizedCloseTimestamp,
    status: b.sourceStatus,
    location: b.location,
    docs: [...b.tenderDocumentLinks].sort(),
    value: b.documentedContractValue,
  });
}

function mergeRecord(existing: TenderRecord, fresh: TenderRecord, now: string) {
  const fields: Array<keyof Pick<TenderRecord,
    "tenderTitle" | "issuer" | "opportunityType" | "category" | "summary" |
    "normalizedCloseTimestamp" | "closingDateTime" | "sourceStatus" | "location" |
    "documentedContractValue"
  >> = [
    "tenderTitle", "issuer", "opportunityType", "category", "summary",
    "normalizedCloseTimestamp", "closingDateTime", "sourceStatus", "location",
    "documentedContractValue",
  ];
  for (const field of fields) {
    if (JSON.stringify(existing[field]) !== JSON.stringify(fresh[field])) {
      existing.materialChangeHistory.unshift({
        at: now,
        field,
        before: existing[field],
        after: fresh[field],
        sourceName: fresh.sourceName,
      });
    }
  }
  const docsBefore = [...existing.tenderDocumentLinks].sort();
  const docsAfter = [...fresh.tenderDocumentLinks].sort();
  if (JSON.stringify(docsBefore) !== JSON.stringify(docsAfter)) {
    existing.materialChangeHistory.unshift({ at: now, field: "tenderDocumentLinks", before: docsBefore, after: docsAfter, sourceName: fresh.sourceName });
  }

  const workflow = existing.workflowStatus;
  Object.assign(existing, {
    ...fresh,
    id: existing.id,
    firstDiscovered: existing.firstDiscovered,
    notes: existing.notes,
    workflowStatus: workflow,
    sourceHistory: existing.sourceHistory,
    materialChangeHistory: existing.materialChangeHistory.slice(0, 100),
  });
  const sourceRef = existing.sourceHistory.find((ref) =>
    ref.sourceName === fresh.sourceName && ref.sourceSpecificId === fresh.sourceSpecificId
  );
  if (sourceRef) sourceRef.lastSeenAt = now;
  else existing.sourceHistory.push(...fresh.sourceHistory);
  if (classifyClosing(existing.normalizedCloseTimestamp) === "expired" && ["New", "Review", "Interested"].includes(existing.workflowStatus)) {
    existing.workflowStatus = "Expired";
  }
  return existing;
}

async function persistScanProgress(orgId: string, run: TenderScanRun) {
  await mutateStore(orgId, (store) => {
    store.currentScan = { ...run, sourceAttempts: [...run.sourceAttempts], errors: [...run.errors] };
  });
}

async function enrichRelevant(records: TenderRecord[], orgId: string, run: TenderScanRun) {
  const candidates = records
    .filter((record) => record.sourceStatus === "open" && record.relevanceScore >= 45 && (!record.enrichedAt || record.materialChangeHistory[0]?.at === record.lastChecked))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 10);
  if (!candidates.length) return;

  let runtime: Awaited<ReturnType<typeof getAiRuntime>>;
  try {
    runtime = await getAiRuntime(orgId);
  } catch (error) {
    run.errors.push(`AI enrichment skipped: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  run.selectedModel = runtime.model;

  type AiResult = {
    enrichments: Array<{
      tenderId: string;
      businessFit: Array<{ business: TenderBusinessContext; reasons: string[]; capabilityMatches: string[] }>;
      opportunityClassification: string;
      commercialHypotheses: string[];
      risksUnknowns: string[];
      questionsToAsk: string[];
      suggestedNextAction: string;
    }>;
  };

  try {
    const response = await requestJsonResponse<AiResult>({
      ...runtime,
      effort: "low",
      system: `You analyse VERIFIED Australian tender records for Solar Power Australia, Solar Online and ELMOFO.
Do not invent tender facts, contacts, budgets, dates, requirements, references or document contents.
Only interpret the supplied records.
Business lenses:
- spa: commercial/industrial solar, BESS, batteries, hybrid, microgrids, remote/off-grid and specialist energy infrastructure.
- solaronline: renewable-energy product supply, panels, batteries, inverters, distribution and product procurement.
- elmofo: EVs, conversion, electrification, batteries, prototype engineering, motorsport technology, specialist manufacturing and R&D/commercialisation.
A tender may fit multiple businesses or none.
Commercial interpretations must be hypotheses, not source facts.`,
      user: `Return {"enrichments":[...]} for these verified records. Keep each array concise.
${JSON.stringify(candidates.map((record) => ({
  tenderId: record.id,
  title: record.tenderTitle,
  issuer: record.issuer,
  reference: record.referenceNumber,
  opportunityType: record.opportunityType,
  category: record.category,
  summary: record.summary,
  state: record.state,
  closing: record.normalizedCloseTimestamp,
  source: record.canonicalSourceUrl,
  deterministicBusinessFits: record.businessFits,
  evidence: record.evidence,
})), null, 2)}`,
    });

    for (const enrichment of response.data.enrichments ?? []) {
      const record = candidates.find((item) => item.id === enrichment.tenderId);
      if (!record) continue;
      const businessReasons = enrichment.businessFit ?? [];
      for (const item of businessReasons) {
        const fit = record.businessFits.find((candidate) => candidate.business === item.business);
        if (!fit) continue;
        fit.reasons = [...new Set([...fit.reasons, ...(item.reasons ?? []).map(String)])].slice(0, 8);
        fit.matchedCapabilities = [...new Set([...fit.matchedCapabilities, ...(item.capabilityMatches ?? []).map(String)])].slice(0, 12);
      }
      record.capabilityMatches = [...new Set(record.businessFits.flatMap((fit) => fit.matchedCapabilities))];
      record.commercialHypotheses = (enrichment.commercialHypotheses ?? []).map(String).slice(0, 8);
      record.risksUnknowns = [...new Set([...record.risksUnknowns, ...(enrichment.risksUnknowns ?? []).map(String)])].slice(0, 12);
      record.questionsToAsk = (enrichment.questionsToAsk ?? []).map(String).slice(0, 10);
      if (enrichment.suggestedNextAction) record.suggestedNextAction = String(enrichment.suggestedNextAction).slice(0, 1000);
      for (const hypothesis of record.commercialHypotheses) {
        record.evidence.push({ statement: hypothesis, sourceUrl: null, classification: "COMMERCIAL_HYPOTHESIS" });
      }
      for (const item of businessReasons.flatMap((entry) => entry.reasons ?? [])) {
        record.evidence.push({ statement: String(item), sourceUrl: null, classification: "INFERENCE" });
      }
      record.enrichmentModel = response.modelUsed;
      record.enrichedAt = new Date().toISOString();
      run.aiEnrichments++;
    }
  } catch (error) {
    run.errors.push(`AI enrichment failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function tenderRecords(orgId: string) {
  const store = await readStore(orgId);
  return store.records.sort((a, b) => {
    if (a.workflowStatus === "Dismissed" && b.workflowStatus !== "Dismissed") return 1;
    if (b.workflowStatus === "Dismissed" && a.workflowStatus !== "Dismissed") return -1;
    return b.relevanceScore - a.relevanceScore || String(a.normalizedCloseTimestamp ?? "9999").localeCompare(String(b.normalizedCloseTimestamp ?? "9999"));
  });
}

export async function tenderById(orgId: string, id: string) {
  const store = await readStore(orgId);
  return store.records.find((record) => record.id === id) ?? null;
}

export async function tenderAudits(orgId: string) {
  return (await readStore(orgId)).audits;
}

export async function tenderScanState(orgId: string) {
  return (await readStore(orgId)).currentScan;
}

export async function setTenderWorkflow(orgId: string, id: string, workflowStatus: TenderWorkflowStatus) {
  return mutateStore(orgId, (store) => {
    const record = store.records.find((item) => item.id === id);
    if (!record) throw new Error("Tender not found.");
    record.workflowStatus = workflowStatus;
    record.lastChecked = new Date().toISOString();
    return record;
  });
}

export async function saveTenderNotes(orgId: string, id: string, notes: string) {
  return mutateStore(orgId, (store) => {
    const record = store.records.find((item) => item.id === id);
    if (!record) throw new Error("Tender not found.");
    record.notes = notes.slice(0, 12000);
    return record;
  });
}

export async function runTenderScan(orgId: string): Promise<TenderScanRun> {
  const r = await redis();
  const lockKey = storeKey(orgId) + ":scan-lock";
  const lockToken = randomUUID();
  const acquired = await r.set(lockKey, lockToken, { NX: true, EX: 900 });
  if (!acquired) throw new Error("A Tender Intelligence scan is already running for this workspace.");
  const releaseLock = async () => {
    try {
      if (await r.get(lockKey) === lockToken) await r.del(lockKey);
    } catch {
      // TTL is the fallback if lock cleanup itself fails.
    }
  };

  const started = Date.now();
  const run: TenderScanRun = {
    id: randomUUID(),
    startedAt: new Date(started).toISOString(),
    endedAt: null,
    durationMs: null,
    state: "running",
    stage: "Starting",
    sourcesAttempted: 0,
    sourceSuccesses: 0,
    sourceFailures: 0,
    sourceAttempts: [],
    opportunitiesDiscovered: 0,
    duplicatesRemoved: 0,
    newTenders: 0,
    updatedTenders: 0,
    unchangedTenders: 0,
    aiEnrichments: 0,
    selectedModel: null,
    errors: [],
  };
  await persistScanProgress(orgId, run);

  try {
    run.stage = "Checking sources";
    await persistScanProgress(orgId, run);

    run.stage = "Retrieving opportunities";
    await persistScanProgress(orgId, run);
    const rawRows: RawTender[] = [];
    for (const adapter of ADAPTERS) {
      const sourceStart = Date.now();
      run.sourcesAttempted++;
      try {
        const rows = await adapter.retrieve();
        rawRows.push(...rows);
        run.sourceSuccesses++;
        run.sourceAttempts.push({
          sourceId: adapter.id, sourceName: adapter.name, status: "success",
          retrieved: rows.length, error: null, durationMs: Date.now() - sourceStart,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run.sourceFailures++;
        run.errors.push(`${adapter.name}: ${message}`);
        run.sourceAttempts.push({
          sourceId: adapter.id, sourceName: adapter.name,
          status: /parser|reliably|stable public feed/i.test(message) ? "limited" : "failed",
          retrieved: 0, error: message, durationMs: Date.now() - sourceStart,
        });
      }
      await persistScanProgress(orgId, run);
    }

    const failedSourceNames = run.sourceAttempts
      .filter((source) => source.status !== "success")
      .map((source) => source.sourceName);
    if (failedSourceNames.length) {
      const fallbackStart = Date.now();
      run.sourcesAttempted++;
      try {
        const fallback = await officialWebSearchFallback(orgId, failedSourceNames);
        rawRows.push(...fallback.rows);
        run.sourceSuccesses++;
        run.selectedModel = fallback.modelUsed;
        run.sourceAttempts.push({
          sourceId: "official-web-search-fallback",
          sourceName: "Official procurement indexed-search fallback",
          status: "success",
          retrieved: fallback.rows.length,
          error: null,
          durationMs: Date.now() - fallbackStart,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run.sourceFailures++;
        run.errors.push(`Official procurement indexed-search fallback: ${message}`);
        run.sourceAttempts.push({
          sourceId: "official-web-search-fallback",
          sourceName: "Official procurement indexed-search fallback",
          status: "limited",
          retrieved: 0,
          error: message,
          durationMs: Date.now() - fallbackStart,
        });
      }
      await persistScanProgress(orgId, run);
    }

    run.opportunitiesDiscovered = rawRows.length;

    run.stage = "Verifying";
    await persistScanProgress(orgId, run);
    const verified = rawRows.filter((row) =>
      !!row.tenderTitle.trim() &&
      !!row.issuer.trim() &&
      !!row.sourceName.trim() &&
      !!row.sourceSpecificId.trim() &&
      /^https?:\/\//i.test(row.sourceUrl) &&
      (row.retrievalMethod !== "search" || isOfficialAustralianProcurementUrl(row.sourceUrl))
    );

    run.stage = "Deduplicating";
    await persistScanProgress(orgId, run);
    const now = new Date().toISOString();
    const unique = new Map<string, TenderRecord>();
    const secondary = new Map<string, string>();
    for (const raw of verified) {
      const primaryKey = deterministicTenderKey(raw);
      const secondaryKey = secondaryTenderKey(raw);
      const existingKey = unique.has(primaryKey) ? primaryKey : secondary.get(secondaryKey);
      if (existingKey) {
        const current = unique.get(existingKey)!;
        const candidate = normalizeRaw(raw, now);
        current.sourceHistory.push(...candidate.sourceHistory.filter((ref) =>
          !current.sourceHistory.some((old) => old.sourceName === ref.sourceName && old.sourceSpecificId === ref.sourceSpecificId)
        ));
        run.duplicatesRemoved++;
      } else {
        const record = normalizeRaw(raw, now);
        unique.set(primaryKey, record);
        secondary.set(secondaryKey, primaryKey);
      }
    }

    run.stage = "Analysing relevance";
    await persistScanProgress(orgId, run);
    const incoming = [...unique.values()];
    await enrichRelevant(incoming, orgId, run);

    run.stage = "Saving";
    await persistScanProgress(orgId, run);
    await mutateStore(orgId, (store) => {
      for (const fresh of incoming) {
        const existing = store.records.find((record) =>
          record.sourceHistory.some((ref) =>
            ref.sourceName === fresh.sourceName && ref.sourceSpecificId === fresh.sourceSpecificId
          ) ||
          (record.referenceNumber && fresh.referenceNumber &&
            record.referenceNumber === fresh.referenceNumber &&
            record.issuer.toLowerCase() === fresh.issuer.toLowerCase()) ||
          secondaryTenderKey({
            issuer: record.issuer,
            tenderTitle: record.tenderTitle,
            closingDateRaw: record.closingDateTime,
            location: record.location,
          }) === secondaryTenderKey({
            issuer: fresh.issuer,
            tenderTitle: fresh.tenderTitle,
            closingDateRaw: fresh.closingDateTime,
            location: fresh.location,
          })
        );

        if (!existing) {
          store.records.push(fresh);
          run.newTenders++;
          continue;
        }

        const changed = !sameMaterial(existing, fresh);
        if (changed) {
          mergeRecord(existing, fresh, now);
          run.updatedTenders++;
        } else {
          existing.lastChecked = now;
          const ref = existing.sourceHistory.find((item) =>
            item.sourceName === fresh.sourceName && item.sourceSpecificId === fresh.sourceSpecificId
          );
          if (ref) ref.lastSeenAt = now;
          if (classifyClosing(existing.normalizedCloseTimestamp) === "expired" && ["New", "Review", "Interested"].includes(existing.workflowStatus)) {
            existing.workflowStatus = "Expired";
          }
          run.unchangedTenders++;
        }
      }
    });

    run.endedAt = new Date().toISOString();
    run.durationMs = Date.now() - started;
    run.state = run.sourceSuccesses === 0 ? "failed" : run.sourceFailures ? "partial" : "success";
    run.stage = "Complete";
    await mutateStore(orgId, (store) => {
      store.currentScan = run;
      store.audits.unshift(run);
      store.audits = store.audits.slice(0, 50);
    });
    await releaseLock();
    return run;
  } catch (error) {
    run.errors.push(error instanceof Error ? error.message : String(error));
    run.endedAt = new Date().toISOString();
    run.durationMs = Date.now() - started;
    run.state = "failed";
    run.stage = "Complete";
    await mutateStore(orgId, (store) => {
      store.currentScan = run;
      store.audits.unshift(run);
      store.audits = store.audits.slice(0, 50);
    });
    await releaseLock();
    return run;
  }
}
