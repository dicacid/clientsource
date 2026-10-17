export const AUTOMATIC_ACCESS_DOMAINS = [
  "revealingmindai.org",
  "solaronline.com.au",
  "solarpoweraustralia.com.au",
  "elmofo.com.au",
] as const;

// Override with a comma-separated allow-list at deployment time. An empty
// override disables automatic domain membership; existing memberships remain.
const configured = typeof process !== "undefined" ? process.env["SPA_AUTO_ACCESS_DOMAINS"] : undefined;
const approvedDomains = new Set<string>((configured === undefined ? [...AUTOMATIC_ACCESS_DOMAINS] : configured.split(","))
  .map(domain => domain.trim().toLowerCase()).filter(Boolean));

export function hasAutomaticCompanyAccess(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return false;
  return approvedDomains.has(normalized.split("@")[1]!);
}
