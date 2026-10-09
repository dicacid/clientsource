/**
 * Unauthenticated guest data lives only in this browser tab.
 * No shared Redis records or workspace membership are touched.
 */
type QueryFilter = { op: string; column: string; value: unknown; comparator?: string };
type GuestQuery = {
  table: string;
  action: "select" | "insert" | "update" | "delete";
  filters?: QueryFilter[];
  orders?: { column: string; ascending: boolean; nullsFirst?: boolean }[];
  range?: [number, number];
  limit?: number;
  mode?: "single" | "maybeSingle";
  payload?: any;
  returning?: boolean;
  countExact?: boolean;
  head?: boolean;
};
type Row = Record<string, any>;
type GuestState = Record<string, Row[]>;

const KEY = "prospect-finder.guest-v1";
const PERSONAL = new Set(["companies", "contacts", "activities", "prospect_dossiers", "party_events"]);
const READ_ONLY = new Set(["profiles", "organizations", "organization_members", "pending_invites"]);
let fallbackState: GuestState = {};
const guestProfile = { id: "guest", full_name: "Guest", email: "", created_at: "" };
const guestMembership = { user_id: "guest", organization_id: "guest", role: "owner", created_at: "" };
const guestOrganization = { id: "guest", name: "My free workspace" };

function errorResult(message: string) {
  return { data: null, error: { message }, count: null };
}

function load(): GuestState {
  try {
    const s = sessionStorage.getItem(KEY);
    return s ? JSON.parse(s) as GuestState : fallbackState;
  } catch {
    return fallbackState;
  }
}

function save(state: GuestState) {
  fallbackState = state;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Incognito/storage-disabled browsers still have isolated in-memory data.
  }
}

function baseRows(state: GuestState, table: string): Row[] {
  if (table === "profiles") return [guestProfile];
  if (table === "organizations") return [guestOrganization];
  if (table === "organization_members") return [guestMembership];
  if (table === "pending_invites") return [];
  if (!PERSONAL.has(table)) return [];
  return (state[table] ?? []).filter(row => row.organization_id === "guest" && row.owner_user_id === "guest");
}

function matches(row: Row, f: QueryFilter): boolean {
  const x = row[f.column];
  if (f.op === "eq") return x === f.value;
  if (f.op === "in") return Array.isArray(f.value) && f.value.includes(x);
  if (f.op === "ilike") {
    const needle = String(f.value ?? "").replace(/^%|%$/g, "").toLowerCase();
    return String(x ?? "").toLowerCase().includes(needle);
  }
  if (f.op === "lt") return x != null && String(x) < String(f.value);
  if (f.op === "gte") return x != null && String(x) >= String(f.value);
  if (f.op === "lte") return x != null && String(x) <= String(f.value);
  if (f.op === "not" && f.comparator === "is") return f.value === null ? x != null : x !== f.value;
  if (f.op === "not" && f.comparator === "in") {
    const values = Array.isArray(f.value) ? f.value : String(f.value ?? "").replace(/^\(|\)$/g, "").split(",").map(s => s.trim());
    return !values.includes(x);
  }
  return true;
}

function decorate(state: GuestState, table: string, row: Row): Row {
  const out = { ...row };
  if (table === "contacts") {
    const company = baseRows(state, "companies").find(c => c.id === row.company_id);
    out.companies = company ? { name: company.name, website: company.website } : null;
  }
  if (table === "organization_members") out.organizations = { name: guestOrganization.name };
  return out;
}

function result(state: GuestState, q: GuestQuery, rows: Row[], count: number) {
  if (q.head) return { data: null, error: null, count: q.countExact ? count : null };
  const out = rows.map(row => decorate(state, q.table, row));
  if (q.mode === "single" && out.length !== 1) return errorResult("Expected exactly one record.");
  if (q.mode === "maybeSingle" && out.length > 1) return errorResult("Expected at most one record.");
  return {
    data: q.mode === "single" || q.mode === "maybeSingle" ? out[0] ?? null : out,
    error: null,
    count: q.countExact ? count : null,
  };
}

export function executeGuestRequest(q: GuestQuery) {
  try {
    const state = load();
    if (!PERSONAL.has(q.table) && !READ_ONLY.has(q.table)) return errorResult("Unsupported guest data table.");
    const filtered = baseRows(state, q.table).filter(row => (q.filters ?? []).every(f => matches(row, f)));
    if (q.action === "select") {
      let rows = filtered.slice();
      for (const order of [...(q.orders ?? [])].reverse()) {
        rows.sort((a, b) => {
          const aa = a[order.column], bb = b[order.column];
          if (aa == null && bb == null) return 0;
          if (aa == null) return order.nullsFirst ? -1 : 1;
          if (bb == null) return order.nullsFirst ? 1 : -1;
          const c = typeof aa === "number" && typeof bb === "number" ? aa - bb : String(aa).localeCompare(String(bb));
          return order.ascending ? c : -c;
        });
      }
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      else if (q.limit !== undefined) rows = rows.slice(0, q.limit);
      return result(state, q, rows, filtered.length);
    }
    if (READ_ONLY.has(q.table)) return errorResult("Guest memberships and profiles cannot be modified.");
    if (q.action === "insert") {
      const input = Array.isArray(q.payload) ? q.payload : [q.payload];
      if (baseRows(state, q.table).length + input.length > 2000) return errorResult("This browser tab's research storage is full.");
      const now = new Date().toISOString();
      const rows = input.map(value => {
        if (!value || typeof value !== "object") throw new Error("Invalid guest record.");
        const row = {
          ...value,
          id: crypto.randomUUID(),
          organization_id: "guest",
          owner_user_id: "guest",
          created_at: now,
        };
        if (q.table === "companies") row.website = row.website || null;
        if (q.table === "contacts") {
          if (!baseRows(state, "companies").some(c => c.id === row.company_id)) throw new Error("Select a company from this workspace.");
        }
        if (q.table === "activities") {
          if (!baseRows(state, "companies").some(c => c.id === row.company_id)) throw new Error("Company not found.");
          row.created_by = "guest";
        }
        if (q.table === "party_events") {
          row.created_by = "guest";
          row.updated_by = "guest";
          row.updated_at = now;
        }
        return row;
      });
      state[q.table] = [...(state[q.table] ?? []), ...rows];
      save(state);
      return result(state, q, q.returning ? rows : [], rows.length);
    }
    if (q.action === "update") {
      const patch = { ...q.payload };
      delete patch.id;
      delete patch.organization_id;
      delete patch.owner_user_id;
      delete patch.created_by;
      const ids = new Set(filtered.map(row => row.id));
      const updated: Row[] = [];
      state[q.table] = (state[q.table] ?? []).map(row => {
        if (!ids.has(row.id)) return row;
        const next = { ...row, ...patch };
        updated.push(next);
        return next;
      });
      save(state);
      return result(state, q, q.returning ? updated : [], updated.length);
    }
    if (q.action === "delete") {
      const ids = new Set(filtered.map(row => row.id));
      if (q.table === "companies" && baseRows(state, "contacts").some(row => ids.has(row.company_id))) {
        return errorResult("Delete the company's contacts before deleting the company.");
      }
      state[q.table] = (state[q.table] ?? []).filter(row => !ids.has(row.id));
      if (q.table === "companies") {
        for (const table of ["activities", "prospect_dossiers"]) {
          state[table] = (state[table] ?? []).filter(row => !ids.has(row.company_id));
        }
      }
      save(state);
      return result(state, q, [], ids.size);
    }
    return errorResult("Unsupported guest operation.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
