export type BusinessContextId = "spa" | "solaronline" | "elmofo";

export type TenderWorkflowStatus =
  | "New"
  | "Review"
  | "Interested"
  | "Pursue"
  | "Bid / Response in progress"
  | "Submitted"
  | "Won"
  | "Lost"
  | "No bid"
  | "Dismissed"
  | "Expired";

export type ClosingWindow =
  | "within_48_hours"
  | "within_7_days"
  | "within_14_days"
  | "later"
  | "unknown"
  | "expired";

export type EvidenceClassification =
  | "OBSERVED_FACT"
  | "SOURCE_CLAIM"
  | "INFERENCE"
  | "COMMERCIAL_HYPOTHESIS"
  | "UNKNOWN";

export type EvidenceItem = {
  statement: string;
  sourceUrl: string | null;
  classification: EvidenceClassification;
};

export type ScoreFactor = {
  factor: string;
  points: number;
  maxPoints: number;
  explanation: string;
};

export type BusinessFit = {
  business: BusinessContextId;
  businessName: string;
  score: number;
  capabilityMatches: string[];
  reasons: string[];
};

export type TenderLike = {
  title: string;
  issuer?: string | null;
  summary?: string | null;
  category?: string | null;
  state?: string | null;
  country?: string | null;
  location?: string | null;
  sourceName?: string | null;
  sourceSpecificId?: string | null;
  referenceNumber?: string | null;
  canonicalSourceUrl?: string | null;
  sourceStatus?: string | null;
  normalizedCloseTimestamp?: string | null;
  evidence?: EvidenceItem[];
};

type CapabilityRule = {
  label: string;
  weight: number;
  terms: string[];
};

const RULES: Record<BusinessContextId, CapabilityRule[]> = {
  spa: [
    { label: "Commercial / industrial solar", weight: 10, terms: ["solar", "photovoltaic", "pv system", "renewable energy"] },
    { label: "Battery energy storage / BESS", weight: 12, terms: ["bess", "battery energy storage", "energy storage", "battery system", "battery storage"] },
    { label: "Remote / off-grid / hybrid power", weight: 12, terms: ["off-grid", "off grid", "remote power", "hybrid power", "microgrid", "micro-grid"] },
    { label: "Mining / resources energy systems", weight: 8, terms: ["mine site", "mining", "resources sector", "remote site"] },
    { label: "Relocatable / skid / trailer systems", weight: 8, terms: ["skid", "relocatable", "mobile power", "power trailer", "solar trailer"] },
    { label: "Specialist energy infrastructure", weight: 7, terms: ["power infrastructure", "electrical infrastructure", "distributed energy", "energy system"] },
  ],
  solaronline: [
    { label: "Solar product supply", weight: 11, terms: ["solar panel", "solar module", "pv module", "photovoltaic module", "solar equipment"] },
    { label: "Battery product supply", weight: 11, terms: ["battery", "battery storage", "energy storage equipment"] },
    { label: "Inverter / power electronics supply", weight: 10, terms: ["inverter", "power electronics", "charger", "solar controller"] },
    { label: "Wholesale / distribution", weight: 10, terms: ["supply", "supplier", "distribution", "distributor", "wholesale", "procurement of"] },
    { label: "Renewable energy product procurement", weight: 8, terms: ["renewable energy equipment", "renewable energy products", "solar products"] },
  ],
  elmofo: [
    { label: "EV / vehicle electrification", weight: 12, terms: ["electric vehicle", "ev conversion", "electrification", "electric drivetrain", "electric mobility"] },
    { label: "Battery engineering", weight: 10, terms: ["battery pack", "battery system", "lithium battery", "traction battery"] },
    { label: "Prototype / specialist engineering", weight: 10, terms: ["prototype", "prototyping", "specialist engineering", "custom engineering", "engineering development"] },
    { label: "Motorsport technology", weight: 8, terms: ["motorsport", "race vehicle", "performance vehicle"] },
    { label: "R&D / commercialisation", weight: 8, terms: ["research and development", "r&d", "commercialisation", "technology partnership", "innovation program"] },
    { label: "Specialist manufacturing", weight: 8, terms: ["specialist manufacturing", "advanced manufacturing", "low volume manufacturing"] },
  ],
};

const BUSINESS_NAMES: Record<BusinessContextId, string> = {
  spa: "Solar Power Australia",
  solaronline: "Solar Online",
  elmofo: "ELMOFO",
};

export function normalizeIdentityText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function canonicalIdentityCandidates(tender: TenderLike): string[] {
  const source = normalizeIdentityText(tender.sourceName);
  const ref = normalizeIdentityText(tender.referenceNumber);
  const sourceId = normalizeIdentityText(tender.sourceSpecificId);
  const url = String(tender.canonicalSourceUrl ?? "").trim().toLowerCase().replace(/\/$/, "");
  const title = normalizeIdentityText(tender.title);
  const issuer = normalizeIdentityText(tender.issuer);
  const close = String(tender.normalizedCloseTimestamp ?? "").slice(0, 10);
  const location = normalizeIdentityText(tender.location || tender.state);
  return [
    source && sourceId ? "source:" + source + ":" + sourceId : "",
    source && ref ? "ref:" + source + ":" + ref : "",
    ref ? "ref-global:" + ref : "",
    url ? "url:" + url : "",
    title && issuer ? "secondary:" + issuer + ":" + title + ":" + close + ":" + location : "",
  ].filter(Boolean);
}

export function classifyClosingDate(
  normalizedCloseTimestamp: string | null | undefined,
  now = new Date(),
): ClosingWindow {
  if (!normalizedCloseTimestamp) return "unknown";
  const close = new Date(normalizedCloseTimestamp);
  if (Number.isNaN(close.getTime())) return "unknown";
  const diff = close.getTime() - now.getTime();
  if (diff < 0) return "expired";
  if (diff <= 48 * 60 * 60 * 1000) return "within_48_hours";
  if (diff <= 7 * 24 * 60 * 60 * 1000) return "within_7_days";
  if (diff <= 14 * 24 * 60 * 60 * 1000) return "within_14_days";
  return "later";
}

function partsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function localDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i++) {
    const actual = partsInTimeZone(new Date(guess), timeZone);
    const wantedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const delta = wantedUtc - actualUtc;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess);
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function parseAustralianDate(
  raw: string | null | undefined,
  timeZone = "Australia/Sydney",
): string | null {
  if (!raw) return null;
  const text = raw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const match = text.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?,?\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (!match) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const day = Number(match[1]);
  const month = MONTHS[String(match[2]).toLowerCase()];
  const year = Number(match[3]);
  if (!month) return null;
  let hour = Number(match[4] ?? 23);
  const minute = Number(match[5] ?? 59);
  const meridiem = String(match[6] ?? "").toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return localDateTimeToUtc(year, month, day, hour, minute, timeZone).toISOString();
}

function corpus(tender: TenderLike): string {
  return normalizeIdentityText([
    tender.title,
    tender.issuer,
    tender.summary,
    tender.category,
    tender.location,
    tender.state,
  ].filter(Boolean).join(" "));
}

export function analyseBusinessFit(tender: TenderLike): BusinessFit[] {
  const text = corpus(tender);
  return (Object.keys(RULES) as BusinessContextId[]).map((business) => {
    const matches: string[] = [];
    let score = 0;
    for (const rule of RULES[business]) {
      if (rule.terms.some((term) => text.includes(normalizeIdentityText(term)))) {
        matches.push(rule.label);
        score += rule.weight;
      }
    }
    score = Math.min(100, score * 2);
    const reasons = matches.length
      ? matches.map((m) => "Evidence text matches " + m + ".")
      : ["No strong capability-language match was found in the verified tender text."];
    return {
      business,
      businessName: BUSINESS_NAMES[business],
      score,
      capabilityMatches: matches,
      reasons,
    };
  });
}

export function scoreTender(
  tender: TenderLike,
  businessFits: BusinessFit[],
  now = new Date(),
): { score: number; factors: ScoreFactor[]; explanation: string } {
  const bestFit = businessFits.reduce((best, current) => current.score > best.score ? current : best, businessFits[0] ?? {
    business: "spa" as const,
    businessName: "Solar Power Australia",
    score: 0,
    capabilityMatches: [],
    reasons: [],
  });
  const closing = classifyClosingDate(tender.normalizedCloseTimestamp, now);
  const sourceName = normalizeIdentityText(tender.sourceName);
  const sourceQuality = /austender|nsw|victoria|government|gov|council|utility/.test(sourceName) ? 10 : 6;
  const geography = !tender.country || /australia/i.test(tender.country) ? 10 : 2;
  const stage = /open|published|current|active/i.test(String(tender.sourceStatus ?? "")) ? 8 : 4;
  const urgency =
    closing === "within_48_hours" ? 2 :
    closing === "within_7_days" ? 5 :
    closing === "within_14_days" ? 4 :
    closing === "later" ? 3 :
    closing === "expired" ? 0 : 1;
  const evidenceStrength = Math.min(7, (tender.evidence ?? []).filter((e) =>
    e.classification === "OBSERVED_FACT" || e.classification === "SOURCE_CLAIM"
  ).length * 2 + (tender.referenceNumber ? 1 : 0) + (tender.canonicalSourceUrl ? 1 : 0));

  const factors: ScoreFactor[] = [
    {
      factor: "Business fit",
      points: Math.round(35 * Math.min(100, bestFit.score) / 100),
      maxPoints: 35,
      explanation: bestFit.score ? "Best current fit is " + bestFit.businessName + "." : "No strong business fit yet.",
    },
    {
      factor: "Capability alignment",
      points: Math.min(25, bestFit.capabilityMatches.length * 6),
      maxPoints: 25,
      explanation: bestFit.capabilityMatches.length
        ? bestFit.capabilityMatches.join(", ")
        : "No verified capability-language match yet.",
    },
    { factor: "Geography", points: geography, maxPoints: 10, explanation: geography === 10 ? "Australian opportunity." : "Geography needs review." },
    { factor: "Source quality", points: sourceQuality, maxPoints: 10, explanation: sourceQuality === 10 ? "Official/public procurement source." : "Source requires additional verification." },
    { factor: "Opportunity stage", points: stage, maxPoints: 8, explanation: stage === 8 ? "Source indicates an active/open opportunity." : "Opportunity stage is unclear or not open." },
    { factor: "Closing-date urgency", points: urgency, maxPoints: 5, explanation: closing.replaceAll("_", " ") + "." },
    { factor: "Evidence strength", points: evidenceStrength, maxPoints: 7, explanation: "Based on verified source fields and evidence items." },
  ];
  const score = factors.reduce((sum, factor) => sum + factor.points, 0);
  return {
    score,
    factors,
    explanation: "Explainable capability-relevance score based on business fit, evidence and timing. It is not a probability of winning.",
  };
}

export function assignedBusinesses(fits: BusinessFit[]): BusinessContextId[] {
  return fits
    .filter((fit) => fit.score >= 10 && fit.capabilityMatches.length > 0)
    .map((fit) => fit.business);
}
