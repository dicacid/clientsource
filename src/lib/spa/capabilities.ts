export type CapabilityConfidence = "CONFIRMED" | "LIKELY / ADJACENT" | "NEEDS VERIFICATION";

export type SpaCapability = {
  capability: string;
  confidence: CapabilityConfidence;
  evidence: string;
};

export const SPA_CAPABILITIES: SpaCapability[] = [
  { capability: "Commercial solar", confidence: "CONFIRMED", evidence: "Solar Power Australia publicly describes commercial solar systems." },
  { capability: "Industrial solar", confidence: "CONFIRMED", evidence: "Solar Power Australia publicly describes industrial solar power." },
  { capability: "PV systems", confidence: "CONFIRMED", evidence: "Core public offering across residential, commercial and industrial solar." },
  { capability: "Battery energy storage systems / BESS", confidence: "CONFIRMED", evidence: "Public site describes energy storage and battery systems." },
  { capability: "Off-grid and remote power", confidence: "CONFIRMED", evidence: "Public site describes remote / off-grid solar and remote industrial systems." },
  { capability: "Solar power trailers, stations and relocatable skids", confidence: "CONFIRMED", evidence: "Public industrial offering includes solar trailers, power stations and solar skids." },
  { capability: "Repurposed EV battery systems", confidence: "CONFIRMED", evidence: "Public commercial offering includes repurposed EV battery systems." },
  { capability: "Solar lighting", confidence: "CONFIRMED", evidence: "Public industrial offering includes solar lighting." },
  { capability: "Custom-designed specialist energy systems", confidence: "CONFIRMED", evidence: "SPA states it delivers specialist, custom-designed solar energy solutions." },
  { capability: "Energy storage integration", confidence: "CONFIRMED", evidence: "SPA and Solar Online publicly describe battery and renewable-energy integration." },
  { capability: "EV engineering and electrification", confidence: "CONFIRMED", evidence: "SPA identifies ELMOFO as its electric-vehicle technology operation." },
  { capability: "Prototype/custom energy systems", confidence: "LIKELY / ADJACENT", evidence: "Consistent with SPA/ELMOFO specialist engineering work; exact scope should be verified per opportunity." },
  { capability: "Mining power infrastructure", confidence: "LIKELY / ADJACENT", evidence: "Remote industrial power is confirmed; mining-specific scope should be validated for each project." },
  { capability: "Remote monitoring", confidence: "NEEDS VERIFICATION", evidence: "Do not represent as a confirmed SPA capability without source verification." },
  { capability: "Custom electrical engineering", confidence: "LIKELY / ADJACENT", evidence: "Custom system integration is supported publicly; exact engineering service scope needs validation." },
  { capability: "Custom mechanical engineering", confidence: "NEEDS VERIFICATION", evidence: "Treat as unverified until Brett confirms current delivery capability." },
  { capability: "Pumping applications", confidence: "NEEDS VERIFICATION", evidence: "Potential adjacent application; verify before using commercially." },
  { capability: "CCTV / access-control power", confidence: "NEEDS VERIFICATION", evidence: "Potential remote-power application; verify before using commercially." },
  { capability: "Radio / repeater power", confidence: "NEEDS VERIFICATION", evidence: "Potential remote-power application; verify before using commercially." },
];

export const BUSINESS_CONTEXTS = {
  spa: {
    name: "Solar Power Australia",
    lens: "commercial, industrial, remote-power, solar, battery, BESS, hybrid-energy and specialist energy-system opportunities",
  },
  solaronline: {
    name: "Solar Online Australia",
    lens: "renewable-energy products, e-commerce/channel, supply, integration and product-demand opportunities",
  },
  elmofo: {
    name: "ELMOFO",
    lens: "electric vehicles, EV conversion, motorsport electrification, specialist batteries, prototype engineering, technology partnerships and commercialisation",
  },
} as const;

export function capabilityText(): string {
  return SPA_CAPABILITIES.map((c) => `- ${c.capability} [${c.confidence}]: ${c.evidence}`).join("\n");
}
