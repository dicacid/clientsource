export const AUTOMATIC_ACCESS_DOMAINS = [
  "revealingmindai.org",
  "solaronline.com.au",
  "solarpoweraustralia.com.au",
  "elmofo.com.au",
] as const;

const approvedDomains = new Set<string>(AUTOMATIC_ACCESS_DOMAINS);

export function hasAutomaticCompanyAccess(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return false;
  return approvedDomains.has(normalized.split("@")[1]!);
}
