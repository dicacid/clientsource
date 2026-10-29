/**
 * Energy Market Lab: live primary-source observations with evidence-first classification.
 * Never treat a URL being reachable as proof that its legislation is in force.
 * Public-only fixed allowlist prevents arbitrary URL fetch/SSRF.
 */
export type PolicyStage = "in_force" | "upcoming" | "consultation";
export type PulseSignal = {
  id: string;
  title: string;
  jurisdiction: string;
  stage: PolicyStage;
  effectiveDate: string;
  sourceUrl: string;
  evidence: string;
  commercialAngle: string;
  nextAction: string;
  audiences: string[];
  verifiedAt: string;
};
export type SourceCheck = {
  id: string;
  url: string;
  status: "verified" | "unavailable" | "no_match";
  httpStatus: number | null;
  checkedAt: string;
  note: string;
};
type Definition = Omit<PulseSignal, "verifiedAt"> & {
  marker: RegExp;
  sourceId: string;
};
const SOURCES = [
  {
    id: "cer",
    url: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/mid-scale-solar",
  },
  {
    id: "nsw",
    url: "https://www.energy.nsw.gov.au/nsw-plans-and-progress/regulation-and-policy/installer-portal",
  },
  {
    id: "wa",
    url: "https://www.wa.gov.au/government/document-collections/plug-power-consultation-legalising-plug-solar-and-batteries",
  },
] as const;

const DEFINITIONS: Definition[] = [
  {
    id: "au-midscale",
    sourceId: "cer",
    title: "100 kW to 1 MW commercial solar incentive expansion",
    jurisdiction: "Australia",
    stage: "in_force",
    effectiveDate: "2026-10-01",
    sourceUrl: SOURCES[0].url,
    evidence: "The Clean Energy Regulator says eligible 100 kW to 1 MW mid-scale solar installed from 1 October 2026 can access the expanded SRES, subject to eligibility. STC applications are expected to open in mid-to-late November.",
    commercialAngle: "Build an evidence-backed outreach list of warehouses, farms and high daytime-load premises that may suit mid-scale PV engineering and installation.",
    nextAction: "Confirm accredited installer capacity, component eligibility, connection feasibility and certificate assumptions before quoting.",
    audiences: ["Warehousing", "Agriculture", "Manufacturing", "Commercial", "Logistics"],
    marker: /(?:100\s?kW|100\s?kilowatt)[\s\S]{0,500}(?:1\s?MW|1\s?megawatt)|(?:1\s?MW|1\s?megawatt)[\s\S]{0,500}(?:100\s?kW|100\s?kilowatt)/i,
  },
  {
    id: "nsw-install",
    sourceId: "nsw",
    title: "NSW solar and battery commissioning workflow changes",
    jurisdiction: "NSW",
    stage: "upcoming",
    effectiveDate: "2026-11-02",
    sourceUrl: SOURCES[1].url,
    evidence: "The NSW Government says the CER Installer Portal rolls out from 2 November 2026 for Endeavour Energy and 23 November for Ausgrid and Essential Energy, subject to the stated connection-application criteria.",
    commercialAngle: "Offer installer enablement, commissioning checklists, compliance integration and approved equipment-readiness services.",
    nextAction: "Confirm the applicable DNSP, connection approval date and technical requirements before proposing a service.",
    audiences: ["Installers", "Commercial", "Agriculture", "Manufacturing"],
    marker: /CER Installer Portal[\s\S]{0,20000}(?:2 November 2026|November 2026)/i,
  },
  {
    id: "wa-balcony",
    sourceId: "wa",
    title: "WA plug-in solar and storage consultation",
    jurisdiction: "WA",
    stage: "consultation",
    effectiveDate: "2026-12-09",
    sourceUrl: SOURCES[2].url,
    evidence: "Western Australia is consulting on a legal pathway for plug-in solar and battery products; submissions close 9 December 2026. Legalisation is not yet established.",
    commercialAngle: "Research compliant product and channel partnerships, but do not sell unapproved plug-in systems as legal or certified.",
    nextAction: "Examine the draft standard and lodge a submission or prepare a contingent distribution strategy.",
    audiences: ["Residential", "Distributors", "Installers"],
    marker: /plug.in solar[\s\S]{0,20000}(?:consultation|legalis)/i,
  },
];

function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function findVerifiedPolicies(sourceText: Record<string, string>, checkedAt: string): PulseSignal[] {
  return DEFINITIONS.filter((d) => {
    const html = sourceText[d.sourceId] ?? "";
    return html.length > 0 && d.marker.test(html);
  }).map(({ sourceId: _sourceId, marker: _marker, ...signal }) => ({ ...signal, verifiedAt: checkedAt }));
}

export function evaluateSolarScenario(input: {
  sizeKw: number; generationKwhPerKwYear: number; selfUsePercent: number;
  importedTariffAud: number; exportTariffAud: number; installedCostAud: number;
  annualOpexAud: number; eligibleIncentiveAud: number;
}) {
  const finite = Object.values(input).every((value) => Number.isFinite(value));
  if (!finite || input.sizeKw <= 0 || input.sizeKw > 100000 ||
    input.generationKwhPerKwYear < 0 || input.generationKwhPerKwYear > 3000 ||
    input.selfUsePercent < 0 || input.selfUsePercent > 100 ||
    input.importedTariffAud < 0 || input.exportTariffAud < 0 ||
    input.installedCostAud < 0 || input.annualOpexAud < 0 || input.eligibleIncentiveAud < 0) {
    throw new Error("Enter realistic non-negative inputs and self-consumption between 0 and 100%.");
  }
  const generationKwh = input.sizeKw * input.generationKwhPerKwYear;
  const selfUseKwh = generationKwh * input.selfUsePercent / 100;
  const exportedKwh = generationKwh - selfUseKwh;
  const annualGrossBenefitAud = selfUseKwh * input.importedTariffAud + exportedKwh * input.exportTariffAud;
  const annualNetBenefitAud = annualGrossBenefitAud - input.annualOpexAud;
  const upfrontNetCostAud = Math.max(0, input.installedCostAud - input.eligibleIncentiveAud);
  const simplePaybackYears = annualNetBenefitAud > 0 ? upfrontNetCostAud / annualNetBenefitAud : null;
  return { generationKwh, selfUseKwh, exportedKwh, annualGrossBenefitAud, annualNetBenefitAud, upfrontNetCostAud, simplePaybackYears };
}

let cache: { until: number; value: { checkedAt: string; checks: SourceCheck[]; signals: PulseSignal[] } } | null = null;
export async function collectLivePolicyPulse() {
  if (cache && Date.now() < cache.until) return cache.value;
  const checkedAt = new Date().toISOString();
  const sourceText: Record<string, string> = {};
  const checks: SourceCheck[] = await Promise.all(SOURCES.map(async (source) => {
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
        headers: { Accept: "text/html", "User-Agent": "EnergyMarketLab/1.0 (policy monitoring; public information)" },
      });
      if (!response.ok) return { id: source.id, url: source.url, status: "unavailable" as const, httpStatus: response.status, checkedAt, note: "Source returned a non-success HTTP response." };
      const type = response.headers.get("content-type") ?? "";
      if (!type.includes("html")) return { id: source.id, url: source.url, status: "unavailable" as const, httpStatus: response.status, checkedAt, note: "Source did not return HTML." };
      const html = (await response.text()).slice(0, 3000000);
      const cleaned = cleanHtml(html);
      sourceText[source.id] = cleaned;
      const matches = DEFINITIONS.some((d) => d.sourceId === source.id && d.marker.test(cleaned));
      return { id: source.id, url: source.url, status: matches ? "verified" as const : "no_match" as const, httpStatus: response.status, checkedAt, note: matches ? "Current official page retrieved and known policy wording matched." : "Official page retrieved but the expected policy wording was not found; no finding asserted." };
    } catch (err) {
      return { id: source.id, url: source.url, status: "unavailable" as const, httpStatus: null, checkedAt, note: err instanceof Error ? err.message.slice(0, 160) : "Fetch failed." };
    }
  }));
  const value = { checkedAt, checks, signals: findVerifiedPolicies(sourceText, checkedAt) };
  // Cache only briefly, and do not retain a failed scan as a success.
  cache = { until: Date.now() + 120000, value };
  return value;
}
