import { createClient, type RedisClientType } from "redis";
import { randomUUID } from "node:crypto";
import { requestJsonResponse } from "./json-response.server";
import { getAiRuntime } from "./openrouter.server";
import { saveResearchRun } from "./store.server";
import {
  analyseBusinessFit,
  assignedBusinesses,
  canonicalIdentityCandidates,
  classifyClosingDate,
  scoreTender,
  type BusinessContextId,
  type BusinessFit,
  type ClosingWindow,
  type EvidenceClassification,
  type EvidenceItem,
  type ScoreFactor,
  type TenderWorkflowStatus,
} from "./tender-core";
import {
  TENDER_SOURCE_ADAPTERS,
  retrieveTenderSource,
  type TenderSourceAdapter,
} from "./tender-sources.server";
import type { RawTender } from "./tender-source-parsers";

export type TenderSourceHistoryEntry = {
  sourceName: string;
  sourceSpecificId: string | null;
  sourceUrl: string;
  firstSeen: string;
  lastSeen: string;
  status: string;
};

export type TenderMaterialChange = {
  at: string;
  field: string;
  before: unknown;
  after: unknown;
  sourceName: string;
};

export type TenderRecord = {
  id: string;
  title: string;
  issuer: string | null;
  referenceNumber: string | null;
  canonicalSourceUrl: string;
  sourceName: string;
  sourceSpecificId: string | null;
  opportunityType: string | null;
  category: string | null;
  summary: string | null;
  publishedDate: string | null;
  closingDateTime: string | null;
  timezone: string;
  normalizedCloseTimestamp: string | null;
  closingWindow: ClosingWindow;
  country: string;
  state: string | null;
  location: string | null;
  documentedContractValue: string | null;
  tenderDocumentLinks: string[];
  firstDiscovered: string;
  lastChecked: string;
  sourceStatus: string;
  workflowStatus: TenderWorkflowStatus;
  assignedBusinessContexts: BusinessContextId[];
  businessFits: BusinessFit[];
  relevanceScore: number;
  relevanceExplanation: string;
  scoreFactors: ScoreFactor[];
  capabilityMatches: string[];
  evidence: EvidenceItem[];
  commercialHypotheses: string[];
  risksUnknowns: string[];
  questionsToAsk: string[];
  suggestedNextAction: string;
  notes: string;
  sourceHistory: TenderSourceHistoryEntry[];
  materialChangeHistory: TenderMaterialChange[];
  aiModelUsed: string | null;
  aiEnrichedAt: string | null;
};

export type TenderScanProgress = {
  runId: string;
  stage:
    | "Starting"
    | "Checking sources"
    | "Retrieving opportunities"
    | "Verifying"
    | "Deduplicating"
    | "Analysing relevance"
    | "Saving"
    | "Complete"
    | "Failed";
  message: string;
  completedSources: number;
  totalSources: number;
  discovered: number;
  updatedAt: string;
};

export type TenderScanAudit = {
  id: string;
  trigger: "manual" | "scheduled";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: "success" | "partial" | "failed";
  sourcesAttempted: string[];
  sourceSuccesses: string[];
  sourceFailures: Array<{ source: string; error: string }>;
  opportunitiesDiscovered: number;
  duplicatesRemoved: number;
  newTenders: number;
  updatedTenders: number;
  unchangedTenders: number;
  aiEnrichments: number;
  errors: string[];
  selectedModel: string | null;
};

type AiEnrichment = {
  business_fit: Array<{
    business: "spa" | "solaronline" | "elmofo";
    relevant: boolean;
    reasons: string[];
    capability_alignment: string[];
  }>;
  opportunity_classification: string;
  commercial_hypotheses: string[];
  risks_unknowns: string[];
  questions_brett_should_ask: string[];
  suggested_next_action: string;
  evidence: Array<{
    statement: string;
    source_url: string | null;
    classification: EvidenceClassification;
  }>;
};

const TENDER_PREFIX = "spa-intelligence:tenders:v1:";
const RUN_PREFIX = "spa-intelligence:tender-runs:v1:";
const PROGRESS_PREFIX = "spa-intelligence:tender-progress:v1:";
const LOCK_PREFIX = "spa-intelligence:tender-lock:v1:";
const STATE_KEY = process.env["STATE_KEY"] || "spa-intelligence:state:v1";
const MAX_TENDERS = 2500;
const MAX_RUNS = 100;

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function redis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;
  if (!connectPromise) {
    const url = process.env["REDIS_URL"];
    if (!url) throw new Error("REDIS_URL is not configured.");
    const next = createClient({ url });
    next.on("error", (error) => console.error("[SPA Intelligence tenders]", error));
    connectPromise = next.connect().then(() => {
      client = next as RedisClientType;
      return client;
    });
  }
  return connectPromise;
}

function safeArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

async function readTenders(orgId: string): Promise<TenderRecord[]> {
  const r = await redis();
  return safeArray<TenderRecord>(await r.get(TENDER_PREFIX + orgId));
}

async function writeTenders(orgId: string, rows: TenderRecord[]) {
  const r = await redis();
  await r.set(TENDER_PREFIX + orgId, JSON.stringify(rows.slice(0, MAX_TENDERS)));
}

async function readRuns(orgId: string): Promise<TenderScanAudit[]> {
  const r = await redis();
  return safeArray<TenderScanAudit>(await r.get(RUN_PREFIX + orgId));
}

async function writeRuns(orgId: string, rows: TenderScanAudit[]) {
  const r = await redis();
  await r.set(RUN_PREFIX + orgId, JSON.stringify(rows.slice(0, MAX_RUNS)));
}

async function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
  let resolveRun!: (value: T | PromiseLike<T>) => void;
  let rejectRun!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      try { resolveRun(await fn()); }
      catch (error) { rejectRun(error); }
    });
  return result;
}

async function setProgress(orgId: string, progress: TenderScanProgress) {
  const r = await redis();
  await r.set(PROGRESS_PREFIX + orgId, JSON.stringify(progress), { EX: 3600 });
}

export async function tenderProgress(orgId: string): Promise<TenderScanProgress | null> {
  const r = await redis();
  const raw = await r.get(PROGRESS_PREFIX + orgId);
  if (!raw) return null;
  try { return JSON.parse(raw) as TenderScanProgress; }
  catch { return null; }
}

export async function tenderRecords(orgId: string): Promise<TenderRecord[]> {
  const rows = await readTenders(orgId);
  return rows.map((row) => {
    const closingWindow = classifyClosingDate(row.normalizedCloseTimestamp);
    const workflowStatus =
      closingWindow === "expired" &&
      !["Submitted", "Won", "Lost", "No bid", "Dismissed"].includes(row.workflowStatus)
        ? "Expired" as const
        : row.workflowStatus;
    return { ...row, closingWindow, workflowStatus };
  }).sort((a, b) => b.relevanceScore - a.relevanceScore || String(a.normalizedCloseTimestamp ?? "9999").localeCompare(String(b.normalizedCloseTimestamp ?? "9999")));
}

export async function tenderRecord(orgId: string, id: string): Promise<TenderRecord | null> {
  return (await tenderRecords(orgId)).find((row) => row.id === id) ?? null;
}

export async function tenderScanRuns(orgId: string): Promise<TenderScanAudit[]> {
  return readRuns(orgId);
}

export async function setTenderWorkflowStatus(orgId: string, id: string, status: TenderWorkflowStatus) {
  return serializeWrite(async () => {
    const rows = await readTenders(orgId);
    const row = rows.find((item) => item.id === id);
    if (!row) throw new Error("Tender not found.");
    row.workflowStatus = status;
    row.lastChecked = new Date().toISOString();
    await writeTenders(orgId, rows);
    return row;
  });
}

export async function setTenderNotes(orgId: string, id: string, notes: string) {
  return serializeWrite(async () => {
    const rows = await readTenders(orgId);
    const row = rows.find((item) => item.id === id);
    if (!row) throw new Error("Tender not found.");
    row.notes = notes.slice(0, 12000);
    await writeTenders(orgId, rows);
    return row;
  });
}

function rawToRecord(raw: RawTender, now: string): TenderRecord {
  const fits = analyseBusinessFit(raw);
  const scoring = scoreTender(raw, fits, new Date(now));
  const closingWindow = classifyClosingDate(raw.normalizedCloseTimestamp, new Date(now));
  const assigned = assignedBusinesses(fits);
  return {
    id: randomUUID(),
    title: raw.title,
    issuer: raw.issuer,
    referenceNumber: raw.referenceNumber,
    canonicalSourceUrl: raw.canonicalSourceUrl,
    sourceName: raw.sourceName,
    sourceSpecificId: raw.sourceSpecificId,
    opportunityType: raw.opportunityType,
    category: raw.category,
    summary: raw.summary,
    publishedDate: raw.publishedDate,
    closingDateTime: raw.closingDateTime,
    timezone: raw.timezone,
    normalizedCloseTimestamp: raw.normalizedCloseTimestamp,
    closingWindow,
    country: raw.country,
    state: raw.state,
    location: raw.location,
    documentedContractValue: raw.documentedContractValue,
    tenderDocumentLinks: raw.tenderDocumentLinks,
    firstDiscovered: now,
    lastChecked: now,
    sourceStatus: raw.sourceStatus,
    workflowStatus: closingWindow === "expired" ? "Expired" : "New",
    assignedBusinessContexts: assigned,
    businessFits: fits,
    relevanceScore: scoring.score,
    relevanceExplanation: scoring.explanation,
    scoreFactors: scoring.factors,
    capabilityMatches: [...new Set(fits.filter((fit) => assigned.includes(fit.business)).flatMap((fit) => fit.capabilityMatches))],
    evidence: raw.evidence,
    commercialHypotheses: [],
    risksUnknowns: [],
    questionsToAsk: [],
    suggestedNextAction: assigned.length ? "Review the verified tender detail and confirm commercial eligibility before any external action." : "No action until a stronger capability fit is verified.",
    notes: "",
    sourceHistory: [{
      sourceName: raw.sourceName,
      sourceSpecificId: raw.sourceSpecificId,
      sourceUrl: raw.canonicalSourceUrl,
      firstSeen: now,
      lastSeen: now,
      status: raw.sourceStatus,
    }],
    materialChangeHistory: [],
    aiModelUsed: null,
    aiEnrichedAt: null,
  };
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const CHANGE_FIELDS: Array<keyof TenderRecord> = [
  "closingDateTime",
  "normalizedCloseTimestamp",
  "sourceStatus",
  "tenderDocumentLinks",
  "summary",
  "issuer",
  "category",
  "opportunityType",
  "location",
];

function mergeExisting(existing: TenderRecord, incoming: TenderRecord, now: string): { record: TenderRecord; changed: boolean } {
  const changes: TenderMaterialChange[] = [];
  for (const field of CHANGE_FIELDS) {
    if (!valuesEqual(existing[field], incoming[field])) {
      changes.push({
        at: now,
        field,
        before: existing[field],
        after: incoming[field],
        sourceName: incoming.sourceName,
      });
    }
  }

  const history = [...(existing.sourceHistory ?? [])];
  const historyMatch = history.find((item) =>
    item.sourceName === incoming.sourceName &&
    (item.sourceSpecificId && incoming.sourceSpecificId
      ? item.sourceSpecificId === incoming.sourceSpecificId
      : item.sourceUrl === incoming.canonicalSourceUrl)
  );
  if (historyMatch) {
    historyMatch.lastSeen = now;
    historyMatch.status = incoming.sourceStatus;
    historyMatch.sourceUrl = incoming.canonicalSourceUrl;
  } else {
    history.push({
      sourceName: incoming.sourceName,
      sourceSpecificId: incoming.sourceSpecificId,
      sourceUrl: incoming.canonicalSourceUrl,
      firstSeen: now,
      lastSeen: now,
      status: incoming.sourceStatus,
    });
  }

  let workflowStatus = existing.workflowStatus;
  if (workflowStatus !== "Dismissed") {
    if (incoming.closingWindow === "expired" && !["Submitted", "Won", "Lost", "No bid"].includes(workflowStatus)) {
      workflowStatus = "Expired";
    } else if (workflowStatus === "Expired" && incoming.closingWindow !== "expired" && changes.some((x) => x.field === "normalizedCloseTimestamp" || x.field === "sourceStatus")) {
      workflowStatus = "Review";
    }
  }

  return {
    changed: changes.length > 0,
    record: {
      ...incoming,
      id: existing.id,
      firstDiscovered: existing.firstDiscovered,
      lastChecked: now,
      workflowStatus,
      notes: existing.notes,
      sourceHistory: history,
      materialChangeHistory: [...(existing.materialChangeHistory ?? []), ...changes].slice(-150),
      aiModelUsed: existing.aiModelUsed,
      aiEnrichedAt: existing.aiEnrichedAt,
      commercialHypotheses: existing.commercialHypotheses ?? [],
      risksUnknowns: existing.risksUnknowns ?? [],
      questionsToAsk: existing.questionsToAsk ?? [],
      suggestedNextAction: existing.suggestedNextAction || incoming.suggestedNextAction,
      evidence: dedupeEvidence([...(existing.evidence ?? []), ...(incoming.evidence ?? [])]),
    },
  };
}

function dedupeEvidence(evidence: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = item.classification + "|" + item.statement + "|" + (item.sourceUrl ?? "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-100);
}

function findExisting(rows: TenderRecord[], incoming: TenderRecord): TenderRecord | null {
  const keys = new Set(canonicalIdentityCandidates(incoming));
  return rows.find((row) => canonicalIdentityCandidates(row).some((key) => keys.has(key))) ?? null;
}

function dedupeIncoming(rows: RawTender[]): { rows: RawTender[]; removed: number } {
  const output: RawTender[] = [];
  const seen = new Set<string>();
  let removed = 0;
  for (const row of rows) {
    const keys = canonicalIdentityCandidates(row);
    if (keys.some((key) => seen.has(key))) {
      removed++;
      continue;
    }
    keys.forEach((key) => seen.add(key));
    output.push(row);
  }
  return { rows: output, removed };
}

function relevantForVerification(raw: RawTender): number {
  const fits = analyseBusinessFit(raw);
  return scoreTender(raw, fits).score;
}

async function verifyPriorityRecords(rows: RawTender[], adapters: TenderSourceAdapter[]): Promise<RawTender[]> {
  const bySource = new Map(adapters.map((adapter) => [adapter.name, adapter]));
  const ranked = rows
    .map((row, index) => ({ row, index, score: relevantForVerification(row) }))
    .sort((a, b) => b.score - a.score);
  const verifyIndexes = new Set(ranked.filter((item) => item.score >= 15).slice(0, 24).map((item) => item.index));
  const output = [...rows];
  for (let i = 0; i < rows.length; i++) {
    if (!verifyIndexes.has(i)) continue;
    const adapter = bySource.get(rows[i]!.sourceName);
    if (!adapter) continue;
    try {
      output[i] = await adapter.verify(rows[i]!);
    } catch (error) {
      output[i] = {
        ...rows[i]!,
        evidence: [
          ...rows[i]!.evidence,
          {
            statement: "Detail verification could not be completed: " + (error instanceof Error ? error.message : String(error)),
            sourceUrl: rows[i]!.canonicalSourceUrl,
            classification: "UNKNOWN",
          },
        ],
      };
    }
  }
  return output;
}

function aiPrompt(record: TenderRecord): { system: string; user: string } {
  const system = [
    "You are the tender-enrichment stage of SPA Intelligence.",
    "Analyse only the verified tender facts supplied by the application.",
    "Do not search for or invent a tender, contact, budget, project value, closing date, requirement or reference number.",
    "Separate OBSERVED_FACT, SOURCE_CLAIM, INFERENCE, COMMERCIAL_HYPOTHESIS and UNKNOWN.",
    "Evaluate Solar Power Australia, Solar Online and ELMOFO independently. A tender may fit zero, one, two or all three.",
    "Do not describe the relevance score as a probability of winning.",
  ].join("\n");
  const user = JSON.stringify({
    verifiedTender: {
      title: record.title,
      issuer: record.issuer,
      referenceNumber: record.referenceNumber,
      sourceName: record.sourceName,
      sourceUrl: record.canonicalSourceUrl,
      opportunityType: record.opportunityType,
      category: record.category,
      summary: record.summary,
      publishedDate: record.publishedDate,
      closingDateTime: record.closingDateTime,
      normalizedCloseTimestamp: record.normalizedCloseTimestamp,
      country: record.country,
      state: record.state,
      location: record.location,
      documentedContractValue: record.documentedContractValue,
      documentLinks: record.tenderDocumentLinks,
      evidence: record.evidence,
    },
    businessContexts: {
      spa: "Solar Power Australia: commercial solar, industrial solar, BESS, batteries, hybrid systems, microgrids, remote/off-grid power, mining/resources energy systems, relocatable/skid systems and custom specialist energy infrastructure.",
      solaronline: "Solar Online: renewable-energy product supply, solar/battery/inverter equipment, distribution, product procurement, panels, wholesale/channel opportunities and online/product-market opportunities.",
      elmofo: "ELMOFO: EVs, conversion, electrification, batteries, prototype engineering, motorsport technology, specialist manufacturing, technology partnerships and R&D/commercialisation.",
    },
    requiredJson: {
      business_fit: [{ business: "spa | solaronline | elmofo", relevant: true, reasons: ["..."], capability_alignment: ["..."] }],
      opportunity_classification: "concise factual classification",
      commercial_hypotheses: ["clearly labelled hypotheses only"],
      risks_unknowns: ["..."],
      questions_brett_should_ask: ["..."],
      suggested_next_action: "internal next step only; do not send or submit anything",
      evidence: [{ statement: "...", source_url: "exact supplied source URL or null", classification: "OBSERVED_FACT | SOURCE_CLAIM | INFERENCE | COMMERCIAL_HYPOTHESIS | UNKNOWN" }],
    },
  }, null, 2);
  return { system, user };
}

async function enrichRecords(orgId: string, rows: TenderRecord[], errors: string[]) {
  const targets = rows
    .filter((row) => row.assignedBusinessContexts.length && row.relevanceScore >= 20 && row.closingWindow !== "expired")
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 5);
  if (!targets.length) return { count: 0, model: null as string | null };

  let runtime: Awaited<ReturnType<typeof getAiRuntime>>;
  try {
    runtime = await getAiRuntime(orgId);
  } catch (error) {
    errors.push("AI enrichment skipped: " + (error instanceof Error ? error.message : String(error)));
    return { count: 0, model: null as string | null };
  }

  let count = 0;
  for (const row of targets) {
    try {
      const prompt = aiPrompt(row);
      const result = await requestJsonResponse<AiEnrichment>({
        ...runtime,
        system: prompt.system,
        user: prompt.user,
        effort: "low",
      });
      const data = result.data;
      const validBusinesses = (data.business_fit ?? [])
        .filter((fit) => fit.relevant && ["spa", "solaronline", "elmofo"].includes(fit.business))
        .map((fit) => fit.business as BusinessContextId);
      if (validBusinesses.length) {
        row.assignedBusinessContexts = [...new Set([...row.assignedBusinessContexts, ...validBusinesses])];
      }
      const aiCapabilities = (data.business_fit ?? [])
        .filter((fit) => fit.relevant)
        .flatMap((fit) => Array.isArray(fit.capability_alignment) ? fit.capability_alignment : [])
        .map(String)
        .map((x) => x.trim())
        .filter(Boolean);
      row.capabilityMatches = [...new Set([...row.capabilityMatches, ...aiCapabilities])].slice(0, 30);
      row.commercialHypotheses = (data.commercial_hypotheses ?? []).map(String).slice(0, 12);
      row.risksUnknowns = (data.risks_unknowns ?? []).map(String).slice(0, 16);
      row.questionsToAsk = (data.questions_brett_should_ask ?? []).map(String).slice(0, 16);
      row.suggestedNextAction = String(data.suggested_next_action || row.suggestedNextAction).slice(0, 1200);
      row.evidence = dedupeEvidence([
        ...row.evidence,
        ...(data.evidence ?? []).map((item) => ({
          statement: String(item.statement ?? "").slice(0, 1600),
          sourceUrl: item.source_url ? String(item.source_url) : null,
          classification: item.classification,
        })).filter((item) =>
          item.statement &&
          ["OBSERVED_FACT", "SOURCE_CLAIM", "INFERENCE", "COMMERCIAL_HYPOTHESIS", "UNKNOWN"].includes(item.classification)
        ),
      ]);
      row.aiModelUsed = result.modelUsed;
      row.aiEnrichedAt = new Date().toISOString();
      count++;
    } catch (error) {
      errors.push("AI enrichment failed for " + row.title + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }
  return { count, model: runtime.model };
}

export async function runTenderScan(orgId: string, trigger: "manual" | "scheduled" = "manual"): Promise<TenderScanAudit> {
  const r = await redis();
  const lock = await r.set(LOCK_PREFIX + orgId, randomUUID(), { NX: true, EX: 900 });
  if (!lock) throw new Error("A tender scan is already running for this workspace.");

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const errors: string[] = [];
  const sourceFailures: Array<{ source: string; error: string }> = [];
  const sourceSuccesses: string[] = [];
  let audit: TenderScanAudit | null = null;

  const progress = async (
    stage: TenderScanProgress["stage"],
    message: string,
    completedSources = 0,
    discovered = 0,
  ) => setProgress(orgId, {
    runId,
    stage,
    message,
    completedSources,
    totalSources: TENDER_SOURCE_ADAPTERS.length,
    discovered,
    updatedAt: new Date().toISOString(),
  });

  try {
    await progress("Starting", "Initialising tender scan.");

    const rawRows: RawTender[] = [];
    await progress("Checking sources", "Checking enabled official procurement sources.");

    let completedSources = 0;
    for (const adapter of TENDER_SOURCE_ADAPTERS) {
      await progress("Retrieving opportunities", "Retrieving " + adapter.name + ".", completedSources, rawRows.length);
      const result = await retrieveTenderSource(adapter);
      completedSources++;
      if (result.status === "success") {
        sourceSuccesses.push(adapter.name);
        rawRows.push(...result.records);
      } else {
        const message = result.error || "Unknown source failure.";
        sourceFailures.push({ source: adapter.name, error: message });
        errors.push(adapter.name + ": " + message);
      }
      await progress("Retrieving opportunities", "Completed " + adapter.name + ".", completedSources, rawRows.length);
    }

    if (!rawRows.length) {
      throw new Error("No enabled tender source returned retrievable opportunities.");
    }

    await progress("Verifying", "Verifying high-relevance tender details from official sources.", completedSources, rawRows.length);
    const verified = await verifyPriorityRecords(rawRows, TENDER_SOURCE_ADAPTERS);

    await progress("Deduplicating", "Normalising and deduplicating source records.", completedSources, verified.length);
    const deduped = dedupeIncoming(verified);
    const now = new Date().toISOString();
    const current = await readTenders(orgId);
    const next = [...current];
    const touched: TenderRecord[] = [];
    let newTenders = 0;
    let updatedTenders = 0;
    let unchangedTenders = 0;

    for (const raw of deduped.rows) {
      const incoming = rawToRecord(raw, now);
      const existing = findExisting(next, incoming);
      if (!existing) {
        next.unshift(incoming);
        touched.push(incoming);
        newTenders++;
        continue;
      }
      const merged = mergeExisting(existing, incoming, now);
      const index = next.findIndex((row) => row.id === existing.id);
      next[index] = merged.record;
      touched.push(merged.record);
      if (merged.changed) updatedTenders++;
      else unchangedTenders++;
    }

    await progress("Analysing relevance", "Scoring business fit across Solar Power Australia, Solar Online and ELMOFO.", completedSources, deduped.rows.length);
    const enrichment = await enrichRecords(orgId, touched, errors);

    await progress("Saving", "Saving canonical tenders, changes and scan audit.", completedSources, deduped.rows.length);
    await serializeWrite(async () => {
      const latest = await readTenders(orgId);
      const untouched = latest.filter((row) => !touched.some((item) => item.id === row.id));
      const mergedRows = [...touched, ...untouched]
        .sort((a, b) => b.relevanceScore - a.relevanceScore || b.lastChecked.localeCompare(a.lastChecked));
      await writeTenders(orgId, mergedRows);

      audit = {
        id: runId,
        trigger,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        status: sourceSuccesses.length === 0 ? "failed" : (sourceFailures.length || errors.some((x) => x.startsWith("AI enrichment")) ? "partial" : "success"),
        sourcesAttempted: TENDER_SOURCE_ADAPTERS.map((adapter) => adapter.name),
        sourceSuccesses,
        sourceFailures,
        opportunitiesDiscovered: rawRows.length,
        duplicatesRemoved: deduped.removed,
        newTenders,
        updatedTenders,
        unchangedTenders,
        aiEnrichments: enrichment.count,
        errors,
        selectedModel: enrichment.model,
      };
      const runs = await readRuns(orgId);
      await writeRuns(orgId, [audit, ...runs]);
    });

    await saveResearchRun(orgId, {
      query: "Automated Australian tender intelligence scan",
      researchType: "tender-intelligence",
      businessContext: "all",
      researchedAt: audit!.endedAt,
      modelUsed: audit!.selectedModel ?? "deterministic-only",
      status: audit!.status === "success" ? "completed" : audit!.status,
      result: audit,
    }).catch((error) => {
      console.warn("[SPA Intelligence tenders] Could not mirror scan into research history", error);
    });

    await progress("Complete", audit!.status === "partial" ? "Scan completed with isolated source or enrichment limitations." : "Tender scan complete.", completedSources, deduped.rows.length);
    return audit!;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
    audit = {
      id: runId,
      trigger,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      status: "failed",
      sourcesAttempted: TENDER_SOURCE_ADAPTERS.map((adapter) => adapter.name),
      sourceSuccesses,
      sourceFailures,
      opportunitiesDiscovered: 0,
      duplicatesRemoved: 0,
      newTenders: 0,
      updatedTenders: 0,
      unchangedTenders: 0,
      aiEnrichments: 0,
      errors,
      selectedModel: null,
    };
    await serializeWrite(async () => {
      const runs = await readRuns(orgId);
      await writeRuns(orgId, [audit!, ...runs]);
    });
    await progress("Failed", message, sourceSuccesses.length + sourceFailures.length, 0);
    throw error;
  } finally {
    await r.del(LOCK_PREFIX + orgId).catch(() => undefined);
  }
}

export async function organizationIdsForTenderScan(): Promise<string[]> {
  const r = await redis();
  const raw = await r.get(STATE_KEY);
  if (!raw) return [];
  try {
    const state = JSON.parse(raw) as { organizations?: Array<{ id?: string }> };
    return [...new Set((state.organizations ?? []).map((org) => String(org.id ?? "")).filter(Boolean))];
  } catch {
    throw new Error("SPA Intelligence organization state is unreadable.");
  }
}
