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
  parseAustralianLocalDate,
  parseConsolidatedTenderText,
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

const qldForwardProcurementAdapter: TenderSourceAdapter = {
  id: "qld-forward-procurement",
  name: "Queensland Government Forward Procurement Pipeline",
  async retrieve() {
    const resourceId = "d3968658-dbb7-4732-bc19-467c49de23de";
    const sourceUrl = "https://www.data.qld.gov.au/dataset/forward-procurement-pipeline/resource/" + resourceId;
    const apiUrl = "https://www.data.qld.gov.au/api/3/action/datastore_search?resource_id=" +
      resourceId + "&limit=1000";
    type QldForwardRow = {
      "_id"?: number | string;
      "Agency"?: string;
      "Business Unit"?: string;
      "Category Group"?: string;
      "Category"?: string;
      "Program Description"?: string;
      "Estimated Timing for Release to Market"?: string;
      "Procurement Method"?: string;
      "Spend Range"?: string;
      "Funding Status"?: string;
      "Region SA4"?: string;
      "Agency Region"?: string;
      "Link"?: string;
      "Brisbane 2032 related"?: string;
    };
    const payload = await fetchedJson<{ success?: boolean; result?: { records?: QldForwardRow[] } }>(apiUrl, 15000);
    if (!payload.success) throw new Error("Queensland Open Data returned an unsuccessful CKAN response.");

    const records = payload.result?.records ?? [];
    return records.flatMap((row) => {
      const title = String(row["Program Description"] ?? "").trim();
      const issuer = String(row["Agency"] ?? "").trim();
      const rowId = String(row["_id"] ?? "").trim();
      if (!title || !issuer || !rowId) return [];

      const timing = String(row["Estimated Timing for Release to Market"] ?? "").trim();
      const method = String(row["Procurement Method"] ?? "").trim();
      const spendRange = String(row["Spend Range"] ?? "").trim();
      const funding = String(row["Funding Status"] ?? "").trim();
      const businessUnit = String(row["Business Unit"] ?? "").trim();
      const categoryGroup = String(row["Category Group"] ?? "").trim();
      const category = String(row["Category"] ?? "").trim();
      const regionSa4 = String(row["Region SA4"] ?? "").trim();
      const agencyRegion = String(row["Agency Region"] ?? "").trim();
      const related2032 = String(row["Brisbane 2032 related"] ?? "").trim();
      const publishedLink = String(row["Link"] ?? "").trim();
      const sourceLink = /^https?:\/\//i.test(publishedLink) ? publishedLink : null;

      const summaryParts = [
        businessUnit ? "Business unit: " + businessUnit : "",
        timing ? "Estimated timing for release to market: " + timing : "",
        method ? "Procurement method: " + method : "",
        spendRange ? "Published spend range: " + spendRange : "",
        funding ? "Funding status: " + funding : "",
        related2032 ? "Brisbane 2032 related: " + related2032 : "",
        sourceLink ? "Agency/source link: " + sourceLink : "",
      ].filter(Boolean);

      return [{
        sourceName: "Queensland Government Forward Procurement Pipeline",
        sourceSpecificId: "qld-fpp-" + rowId,
        sourceUrl,
        tenderTitle: title.slice(0, 500),
        issuer: issuer.slice(0, 240),
        referenceNumber: null,
        opportunityType: method
          ? "Planned / forward procurement — " + method.slice(0, 120)
          : "Planned / forward procurement",
        category: [categoryGroup, category].filter(Boolean).join(" — ").slice(0, 500) || null,
        summary: summaryParts.join(". ").slice(0, 4000) || null,
        publishedDateRaw: null,
        closingDateRaw: null,
        timezone: "Australia/Brisbane",
        country: "Australia",
        state: "QLD",
        location: [regionSa4, agencyRegion].filter(Boolean).join(" / ").slice(0, 500) || "Queensland",
        documentedContractValue: null,
        tenderDocumentLinks: sourceLink ? [sourceLink] : [],
        sourceStatus: "planned" as const,
      }];
    });
  },
};

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
        sourceUrl,
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
    const url = "https://buy.nsw.gov.au/opportunity/search?types=Tenders";
    const html = await fetchedText(url, 12000);
    const text = decodeHtml(html);
    const matcher = /(.+?)\s+Closes:\s+(\d{1,2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2})[\s\S]{0,700}?([A-Z0-9][A-Z0-9._\/-]{2,80})[\s\S]{0,1000}?Opportunity type\s+(.+?)\s+Agency\s+(.+?)\s+See details/gi;
    const rows: RawTender[] = [];
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text)) !== null) {
      const title = String(match[1] ?? "").trim().split(/Displaying \d+-\d+ of \d+ results/i).pop()!.trim();
      const close = String(match[2] ?? "").trim();
      const reference = String(match[3] ?? "").trim();
      const type = String(match[4] ?? "").trim();
      const issuer = String(match[5] ?? "").trim();
      if (!title || !reference || !issuer) continue;
      const parsed = Date.parse(close.replace(/-/g, " "));
      rows.push({
        sourceName: "buy.nsw Opportunities Hub",
        sourceSpecificId: reference,
        sourceUrl: url,
        tenderTitle: title.slice(-500),
        issuer: issuer.slice(0, 240),
        referenceNumber: reference,
        opportunityType: type.slice(0, 120),
        category: null,
        summary: null,
        publishedDateRaw: null,
        closingDateRaw: Number.isFinite(parsed) ? new Date(parsed).toISOString() : close,
        timezone: "Australia/Sydney",
        country: "Australia",
        state: "NSW",
        location: "New South Wales",
        documentedContractValue: null,
        tenderDocumentLinks: [],
        sourceStatus: "open",
      });
    }
    if (!rows.length) throw new Error("NSW opportunity index is currently not reliably machine-retrievable from the Render runtime.");
    return rows;
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

const ADAPTERS: TenderSourceAdapter[] = [townsvilleAdapter, qldForwardProcurementAdapter, victoriaAdapter, actAdapter, nswAdapter, ausTenderAdapter];

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
  const evidence: TenderEvidence[] = [
    { statement: `Tender title: ${raw.tenderTitle}`, sourceUrl: raw.sourceUrl, classification: "OBSERVED_FACT" },
    { statement: `Issuer: ${raw.issuer}`, sourceUrl: raw.sourceUrl, classification: "OBSERVED_FACT" },
  ];
  if (raw.referenceNumber) evidence.push({ statement: `Reference: ${raw.referenceNumber}`, sourceUrl: raw.sourceUrl, classification: "OBSERVED_FACT" });
  if (raw.closingDateRaw) evidence.push({ statement: `Closing date published as ${raw.closingDateRaw}`, sourceUrl: raw.sourceUrl, classification: "OBSERVED_FACT" });\n  if (raw.summary) evidence.push({ statement: `Source description: ${raw.summary}`, sourceUrl: raw.sourceUrl, classification: "SOURCE_CLAIM" });\n  if (raw.category) evidence.push({ statement: `Source category: ${raw.category}`, sourceUrl: raw.sourceUrl, classification: "OBSERVED_FACT" });

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
    ],
    commercialHypotheses: [],
    questionsToAsk: [],
    suggestedNextAction: raw.sourceStatus === "planned"
      ? (scoring.score >= 65
        ? "Monitor the published release-to-market timing and source link, validate the likely procurement path, and prepare capability positioning before the opportunity opens."
        : "Monitor the forward procurement entry for release-to-market updates and reassess when formal tender evidence is published.")
      : scoring.score >= 65
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
    close: a.normalizedCloseTimestamp,
    status: a.sourceStatus,
    docs: [...a.tenderDocumentLinks].sort(),
    value: a.documentedContractValue,
  }) === JSON.stringify({
    title: b.tenderTitle,
    issuer: b.issuer,
    close: b.normalizedCloseTimestamp,
    status: b.sourceStatus,
    docs: [...b.tenderDocumentLinks].sort(),
    value: b.documentedContractValue,
  });
}

function mergeRecord(existing: TenderRecord, fresh: TenderRecord, now: string) {
  const fields: Array<keyof Pick<TenderRecord, "tenderTitle" | "issuer" | "normalizedCloseTimestamp" | "closingDateTime" | "sourceStatus" | "documentedContractValue">> = [
    "tenderTitle", "issuer", "normalizedCloseTimestamp", "closingDateTime", "sourceStatus", "documentedContractValue",
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
    .filter((record) => ["open", "planned"].includes(record.sourceStatus) && record.relevanceScore >= 45 && (!record.enrichedAt || record.materialChangeHistory[0]?.at === record.lastChecked))
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
    run.opportunitiesDiscovered = rawRows.length;

    run.stage = "Verifying";
    await persistScanProgress(orgId, run);
    const verified = rawRows.filter((row) =>
      !!row.tenderTitle.trim() &&
      !!row.issuer.trim() &&
      !!row.sourceName.trim() &&
      !!row.sourceSpecificId.trim() &&
      /^https?:\/\//i.test(row.sourceUrl)
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
