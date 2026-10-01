export type TenderEvidenceClassification =
  | "OBSERVED_FACT"
  | "SOURCE_CLAIM"
  | "INFERENCE"
  | "COMMERCIAL_HYPOTHESIS"
  | "UNKNOWN";

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

export type TenderBusinessContext = "spa" | "solaronline" | "elmofo";

export type TenderEvidence = {
  statement: string;
  sourceUrl: string | null;
  classification: TenderEvidenceClassification;
};

export type TenderBusinessFit = {
  business: TenderBusinessContext;
  name: string;
  score: number;
  matchedCapabilities: string[];
  reasons: string[];
};

export type TenderScoreFactor = {
  factor: string;
  score: number;
  max: number;
  explanation: string;
};

export type TenderSourceReference = {
  sourceName: string;
  sourceSpecificId: string;
  sourceUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type TenderChange = {
  at: string;
  field: string;
  before: unknown;
  after: unknown;
  sourceName: string;
};

export type TenderRecord = {
  id: string;
  tenderTitle: string;
  issuer: string;
  referenceNumber: string | null;
  canonicalSourceUrl: string;
  sourceName: string;
  sourceSpecificId: string;
  opportunityType: string;
  category: string | null;
  summary: string | null;
  publishedDate: string | null;
  closingDateTime: string | null;
  timezone: string | null;
  normalizedCloseTimestamp: string | null;
  country: string;
  state: string | null;
  location: string | null;
  documentedContractValue: string | null;
  tenderDocumentLinks: string[];
  firstDiscovered: string;
  lastChecked: string;
  sourceStatus: "open" | "closed" | "withdrawn" | "awarded" | "unknown";
  workflowStatus: TenderWorkflowStatus;
  assignedBusinessContexts: TenderBusinessContext[];
  relevanceScore: number;
  relevanceExplanation: string;
  scoreFactors: TenderScoreFactor[];
  businessFits: TenderBusinessFit[];
  capabilityMatches: string[];
  evidence: TenderEvidence[];
  risksUnknowns: string[];
  commercialHypotheses: string[];
  questionsToAsk: string[];
  suggestedNextAction: string;
  notes: string;
  sourceHistory: TenderSourceReference[];
  materialChangeHistory: TenderChange[];
  enrichmentModel: string | null;
  enrichedAt: string | null;
};

export type RawTender = {
  sourceName: string;
  sourceSpecificId: string;
  sourceUrl: string;
  tenderTitle: string;
  issuer: string;
  referenceNumber: string | null;
  opportunityType: string;
  category: string | null;
  summary: string | null;
  publishedDateRaw: string | null;
  closingDateRaw: string | null;
  timezone: string | null;
  country: string;
  state: string | null;
  location: string | null;
  documentedContractValue: string | null;
  tenderDocumentLinks: string[];
  sourceStatus: TenderRecord["sourceStatus"];
};

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

export function normalizeTenderText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function deterministicTenderKey(raw: Pick<RawTender, "sourceName" | "sourceSpecificId" | "referenceNumber" | "sourceUrl" | "issuer" | "tenderTitle" | "closingDateRaw" | "location">) {
  const direct = raw.referenceNumber?.trim() || raw.sourceSpecificId?.trim() || canonicalUrl(raw.sourceUrl);
  if (direct) return normalizeTenderText(raw.sourceName + " " + direct);
  return normalizeTenderText([raw.issuer, raw.tenderTitle, raw.closingDateRaw ?? "", raw.location ?? ""].join(" | "));
}

export function secondaryTenderKey(raw: Pick<RawTender, "issuer" | "tenderTitle" | "closingDateRaw" | "location">) {
  return normalizeTenderText([raw.issuer, raw.tenderTitle, raw.closingDateRaw ?? "", raw.location ?? ""].join(" | "));
}

export function parseAustralianLocalDate(input: string | null, timeZone = "Australia/Melbourne"): string | null {
  if (!input) return null;
  const value = input.trim().replace(/\b([ap])\.m\.\b/gi, "$1m");
  const wordMatch = value.match(/^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  const numericMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*-?\s*(\d{1,2}):(\d{2})\s*(am|pm))?$/i);
  const m = wordMatch ?? numericMatch;
  if (!m) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const day = Number(m[1]);
  const month = wordMatch ? MONTHS[m[2]!.toLowerCase()] : Number(m[2]) - 1;
  const year = Number(m[3]);
  if (month == null || !day || !year) return null;
  let hour = Number(m[4] ?? 0);
  const minute = Number(m[5] ?? 0);
  const meridiem = String(m[6] ?? "am").toLowerCase();
  if (hour === 12) hour = 0;
  if (meridiem === "pm") hour += 12;

  const targetWallClock = Date.UTC(year, month, day, hour, minute, 0);
  let guess = targetWallClock;
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });

  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts["year"]), Number(parts["month"]) - 1, Number(parts["day"]),
      Number(parts["hour"]), Number(parts["minute"]), Number(parts["second"]),
    );
    guess += targetWallClock - represented;
  }
  return new Date(guess).toISOString();
}

export type ClosingBand = "within_48h" | "within_7d" | "within_14d" | "later" | "unknown" | "expired";

export function classifyClosing(closeTimestamp: string | null, now = new Date()): ClosingBand {
  if (!closeTimestamp) return "unknown";
  const ms = Date.parse(closeTimestamp) - now.getTime();
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 0) return "expired";
  if (ms <= 48 * 60 * 60 * 1000) return "within_48h";
  if (ms <= 7 * 24 * 60 * 60 * 1000) return "within_7d";
  if (ms <= 14 * 24 * 60 * 60 * 1000) return "within_14d";
  return "later";
}

const BUSINESS_NAMES: Record<TenderBusinessContext, string> = {
  spa: "Solar Power Australia",
  solaronline: "Solar Online",
  elmofo: "ELMOFO",
};

const MATCHERS: Record<TenderBusinessContext, Array<[RegExp, string, number]>> = {
  spa: [
    [/\bsolar\b|photovoltaic|\bpv\b/i, "Solar / photovoltaic systems", 24],
    [/battery|\bbess\b|energy storage/i, "Battery energy storage / BESS", 24],
    [/microgrid|off[- ]grid|remote power|hybrid (?:energy|power)|power station/i, "Remote, hybrid or microgrid power", 24],
    [/industrial (?:solar|energy|power)|renewable energy|solar generator/i, "Industrial or specialist energy infrastructure", 20],
    [/mining|resources|remote site|relocatable|skid/i, "Remote / relocatable resources applications", 14],
    [/electrical infrastructure|power system|energy system/i, "Custom specialist energy systems", 12],
  ],
  solaronline: [
    [/\bsupply\b|supply and delivery|procurement|equipment|products?/i, "Product supply / procurement", 20],
    [/\bsolar\b|photovoltaic|\bpv\b/i, "Solar products", 22],
    [/battery|inverter|charger|panel|module/i, "Battery, inverter or panel equipment", 22],
    [/wholesale|distribution|distributor|channel|retail/i, "Distribution / channel opportunity", 22],
    [/renewable energy equipment|energy equipment/i, "Renewable-energy equipment", 14],
  ],
  elmofo: [
    [/electric vehicle|\bev\b|electrification/i, "EV / electrification", 24],
    [/motor|drivetrain|vehicle conversion|conversion kit/i, "EV conversion / drivetrain", 22],
    [/prototype|\br&d\b|research and development|technology partner|commercialisation/i, "R&D / prototype / technology partnership", 22],
    [/motorsport|specialist manufacturing|engineering prototype/i, "Motorsport or specialist manufacturing", 18],
    [/battery system|battery pack|high[- ]capacity battery/i, "Specialist battery systems", 14],
  ],
};

export function businessRouting(text: string): TenderBusinessFit[] {
  return (Object.keys(MATCHERS) as TenderBusinessContext[]).map((business) => {
    const matches = MATCHERS[business].filter(([regex]) => regex.test(text));
    const matchedCapabilities = [...new Set(matches.map(([, label]) => label))];
    const score = Math.min(100, matches.reduce((sum, [, , points]) => sum + points, 0));
    return {
      business,
      name: BUSINESS_NAMES[business],
      score,
      matchedCapabilities,
      reasons: matchedCapabilities.map((item) => `Tender text contains evidence relevant to ${item}.`),
    };
  });
}

export function scoreTender(input: {
  title: string;
  summary: string | null;
  category: string | null;
  state: string | null;
  sourceName: string;
  sourceStatus: TenderRecord["sourceStatus"];
  normalizedCloseTimestamp: string | null;
  businessFits: TenderBusinessFit[];
  evidenceCount: number;
}): { score: number; factors: TenderScoreFactor[]; explanation: string } {
  const bestFit = Math.max(0, ...input.businessFits.map((fit) => fit.score));
  const fitScore = Math.round(bestFit * 0.45);
  const capabilityScore = Math.min(20, input.businessFits.reduce((sum, fit) => sum + fit.matchedCapabilities.length * 3, 0));
  const geographyScore = input.state && /NSW|VIC|QLD|SA|WA|TAS|ACT|NT/i.test(input.state) ? 8 : 5;
  const sourceScore = /government|victoria|nsw|austender|council|water|utility/i.test(input.sourceName + " " + input.title) ? 10 : 6;
  const stageScore = input.sourceStatus === "open" ? 8 : input.sourceStatus === "awarded" ? 2 : 0;
  const closingBand = classifyClosing(input.normalizedCloseTimestamp);
  const urgencyScore = closingBand === "within_7d" ? 4 : closingBand === "within_14d" ? 6 : closingBand === "later" ? 8 : closingBand === "within_48h" ? 1 : 3;
  const evidenceScore = Math.min(6, input.evidenceCount * 2);
  const raw = Math.min(100, fitScore + capabilityScore + geographyScore + sourceScore + stageScore + urgencyScore + evidenceScore);

  const factors: TenderScoreFactor[] = [
    { factor: "Business fit", score: fitScore, max: 45, explanation: `Best business-context fit is ${bestFit}/100.` },
    { factor: "Capability alignment", score: capabilityScore, max: 20, explanation: "Based on explicit keyword-to-capability matches in verified tender text." },
    { factor: "Geography", score: geographyScore, max: 8, explanation: input.state ? `Australian state/territory evidence: ${input.state}.` : "Australian source, exact state not confirmed." },
    { factor: "Source quality", score: sourceScore, max: 10, explanation: "Official/public procurement source weighting." },
    { factor: "Opportunity stage", score: stageScore, max: 8, explanation: `Source status is ${input.sourceStatus}.` },
    { factor: "Closing-date timing", score: urgencyScore, max: 8, explanation: `Closing band: ${closingBand}.` },
    { factor: "Evidence strength", score: evidenceScore, max: 6, explanation: `${input.evidenceCount} observed/source evidence item(s).` },
  ];
  return {
    score: raw,
    factors,
    explanation: `Explainable fit score of ${raw}/100. This measures opportunity relevance, not probability of winning.`,
  };
}

export function highRelevance(score: number) {
  return score >= 65;
}


export type ConsolidatedTenderSourceConfig = {
  sourceName: string;
  sourceUrl: string;
  timezone: string;
  state: string;
  location: string;
};

export function parseConsolidatedTenderText(text: string, config: ConsolidatedTenderSourceConfig): RawTender[] {
  const opportunityTypes = [
    "Request for Tender",
    "Expression of Interest",
    "Request for Quotation",
    "Request for Information",
    "Advanced Tender Notice",
    "Other Arrangements",
  ].join("|");
  const matcher = new RegExp(
    `([A-Z0-9][A-Z0-9 ._\\/-]{1,80})\\s+Open\\s+(${opportunityTypes})\\s+(.+?)\\s+Issued by:\\s+(.+?)\\s+UNSPSC[\\s\\S]*?(?:Opened|Released)\\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\\s+\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4}\\s+\\d{1,2}:\\d{2}\\s+(?:am|pm))\\s+Closing\\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\\s+\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4}\\s+\\d{1,2}:\\d{2}\\s+(?:am|pm))`,
    "gi",
  );

  const rows: RawTender[] = [];
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const reference = String(match[1] ?? "")
      .replace(/^RFx Number Status & Type\s*/i, "")
      .replace(/^Details\s*/i, "")
      .trim()
      .slice(0, 120);
    const opportunityType = String(match[2] ?? "").trim();
    const tenderTitle = String(match[3] ?? "").replace(/^Details\s*/i, "").trim();
    const issuer = String(match[4] ?? "").trim();
    const publishedDateRaw = String(match[5] ?? "").trim();
    const closingDateRaw = String(match[6] ?? "").trim();
    if (!reference || !tenderTitle || !issuer) continue;

    rows.push({
      sourceName: config.sourceName,
      sourceSpecificId: reference,
      sourceUrl: config.sourceUrl,
      tenderTitle: tenderTitle.slice(0, 500),
      issuer: issuer.slice(0, 240),
      referenceNumber: reference,
      opportunityType,
      category: null,
      summary: null,
      publishedDateRaw,
      closingDateRaw,
      timezone: config.timezone,
      country: "Australia",
      state: config.state,
      location: config.location,
      documentedContractValue: null,
      tenderDocumentLinks: [],
      sourceStatus: "open",
    });
  }
  return rows;
}
