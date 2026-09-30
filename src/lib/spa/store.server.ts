import { createClient, type RedisClientType } from "redis";
import { randomUUID } from "node:crypto";

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function redis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;
  if (!connectPromise) {
    const url = process.env["REDIS_URL"];
    if (!url) throw new Error("REDIS_URL is not configured.");
    const next = createClient({ url });
    next.on("error", (error) => console.error("[SPA Intelligence workspace store]", error));
    connectPromise = next.connect().then(() => {
      client = next as RedisClientType;
      return client;
    });
  }
  return connectPromise;
}

const historyKey = (orgId: string) => `spa-intelligence:history:v1:${orgId}`;
const approvalKey = (orgId: string) => `spa-intelligence:approvals:v1:${orgId}`;
const capabilityKey = (orgId: string) => `spa-intelligence:capabilities:v1:${orgId}`;
const competitorKey = (orgId: string) => `spa-intelligence:competitors:v1:${orgId}`;

export type ResearchRunRecord = {
  id: string;
  query: string;
  researchType: string;
  businessContext: string;
  researchedAt: string;
  modelUsed: string;
  status: "completed" | "partial" | "failed";
  result: unknown;
};

export type ApprovalState =
  | "DETECTED" | "RESEARCHED" | "QUALIFIED" | "PREPARED" | "AWAITING APPROVAL"
  | "NEEDS CHANGES" | "APPROVED" | "ACTIONED" | "FOLLOW-UP DUE"
  | "WON" | "LOST" | "NO BID" | "ARCHIVED";

export type ApprovalItemRecord = {
  id: string;
  title: string;
  kind: string;
  state: ApprovalState;
  createdAt: string;
  updatedAt: string;
  payload: unknown;
};

export async function saveResearchRun(orgId: string, input: Omit<ResearchRunRecord, "id">) {
  const r = await redis();
  const record: ResearchRunRecord = { id: randomUUID(), ...input };
  await r.lPush(historyKey(orgId), JSON.stringify(record));
  await r.lTrim(historyKey(orgId), 0, 99);
  return record;
}

export async function researchHistory(orgId: string): Promise<ResearchRunRecord[]> {
  const r = await redis();
  const rows = await r.lRange(historyKey(orgId), 0, 99);
  return rows.flatMap((raw) => {
    try { return [JSON.parse(raw) as ResearchRunRecord]; } catch { return []; }
  });
}

async function readApprovals(orgId: string): Promise<ApprovalItemRecord[]> {
  const r = await redis();
  const raw = await r.get(approvalKey(orgId));
  if (!raw) return [];
  try { return JSON.parse(raw) as ApprovalItemRecord[]; } catch { return []; }
}

async function writeApprovals(orgId: string, items: ApprovalItemRecord[]) {
  const r = await redis();
  await r.set(approvalKey(orgId), JSON.stringify(items.slice(0, 250)));
}

export async function approvalItems(orgId: string) {
  return readApprovals(orgId);
}

export async function createApprovalItem(orgId: string, title: string, kind: string, payload: unknown) {
  let created!: ApprovalItemRecord;
  const run = writeQueue.catch(() => undefined).then(async () => {
    const items = await readApprovals(orgId);
    const now = new Date().toISOString();
    created = { id: randomUUID(), title, kind, state: "AWAITING APPROVAL", createdAt: now, updatedAt: now, payload };
    await writeApprovals(orgId, [created, ...items]);
  });
  writeQueue = run;
  await run;
  return created;
}

export async function changeApprovalState(orgId: string, id: string, state: ApprovalState) {
  let found: ApprovalItemRecord | null = null;
  const run = writeQueue.catch(() => undefined).then(async () => {
    const items = await readApprovals(orgId);
    const item = items.find((x) => x.id === id);
    if (!item) throw new Error("Approval item not found.");
    item.state = state;
    item.updatedAt = new Date().toISOString();
    found = item;
    await writeApprovals(orgId, items);
  });
  writeQueue = run;
  await run;
  return found;
}


export async function getCapabilityProfile(orgId: string): Promise<string | null> {
  const r = await redis();
  return r.get(capabilityKey(orgId));
}

export async function saveCapabilityProfile(orgId: string, value: string) {
  const text = value.trim();
  if (!text) throw new Error("Capability profile cannot be empty.");
  if (text.length > 16000) throw new Error("Capability profile is too large.");
  const r = await redis();
  await r.set(capabilityKey(orgId), text);
  return text;
}


export type CompetitorRecord = {
  id: string;
  name: string;
  website: string | null;
  location: string | null;
  category: "direct" | "adjacent" | "large-scale";
  whyCompetitor: string;
  overlapAreas: string[];
  sourceUrls: string[];
  discoveredAt: string;
  updatedAt: string;
  lastAnalysedAt: string | null;
  analysis: unknown | null;
};

async function readCompetitors(orgId: string): Promise<CompetitorRecord[]> {
  const r = await redis();
  const raw = await r.get(competitorKey(orgId));
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw) as CompetitorRecord[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function writeCompetitors(orgId: string, rows: CompetitorRecord[]) {
  const r = await redis();
  await r.set(competitorKey(orgId), JSON.stringify(rows.slice(0, 100)));
}

function competitorIdentity(name: string, website: string | null) {
  const site = (website || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  return site || name.trim().toLowerCase();
}

export async function competitorRegistry(orgId: string) {
  return readCompetitors(orgId);
}

export async function mergeCompetitorDiscovery(
  orgId: string,
  discovered: Array<Omit<CompetitorRecord, "id" | "discoveredAt" | "updatedAt" | "lastAnalysedAt" | "analysis">>,
) {
  const current = await readCompetitors(orgId);
  const now = new Date().toISOString();

  for (const item of discovered) {
    const key = competitorIdentity(item.name, item.website);
    const existing = current.find((row) => competitorIdentity(row.name, row.website) === key);

    if (existing) {
      existing.name = item.name;
      existing.website = item.website;
      existing.location = item.location;
      existing.category = item.category;
      existing.whyCompetitor = item.whyCompetitor;
      existing.overlapAreas = item.overlapAreas;
      existing.sourceUrls = [...new Set([...(existing.sourceUrls ?? []), ...item.sourceUrls])].slice(0, 12);
      existing.updatedAt = now;
    } else {
      current.push({
        id: randomUUID(),
        ...item,
        discoveredAt: now,
        updatedAt: now,
        lastAnalysedAt: null,
        analysis: null,
      });
    }
  }

  current.sort((a, b) => {
    const rank = { direct: 0, adjacent: 1, "large-scale": 2 } as const;
    return rank[a.category] - rank[b.category] || a.name.localeCompare(b.name);
  });

  await writeCompetitors(orgId, current);
  return current;
}

export async function saveCompetitorAnalysis(orgId: string, competitorId: string, analysis: unknown) {
  const rows = await readCompetitors(orgId);
  const row = rows.find((item) => item.id === competitorId);
  if (!row) throw new Error("Competitor record not found.");
  const now = new Date().toISOString();
  row.analysis = analysis;
  row.lastAnalysedAt = now;
  row.updatedAt = now;
  await writeCompetitors(orgId, rows);
  return row;
}

export async function removeCompetitor(orgId: string, competitorId: string) {
  const rows = await readCompetitors(orgId);
  const next = rows.filter((item) => item.id !== competitorId);
  await writeCompetitors(orgId, next);
  return next;
}
