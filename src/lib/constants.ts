export const COMPANY_STATUSES = ["new", "researching", "contacted", "engaged", "qualified", "customer", "lost"] as const;
export const CONTACT_STATUSES = ["new", "contacted", "meeting", "customer", "lost"] as const;
export const EMPLOYEE_RANGES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;
export const ACTIVITY_TYPES = ["note", "call", "meeting", "follow_up"] as const;
export const CLOSED_STATUSES = ["customer", "lost"];

export type CompanyStatus = (typeof COMPANY_STATUSES)[number];
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export type Role = "owner" | "admin" | "member";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function label(s: string) {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
