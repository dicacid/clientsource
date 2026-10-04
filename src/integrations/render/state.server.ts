import { createClient, type RedisClientType } from "redis";
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

const STATE_KEY = "clientsource:state:v1";

type Role = "owner" | "admin" | "member";
type User = { id: string; email: string; password_hash: string; created_at: string };
type Profile = { id: string; full_name: string | null; created_at: string };
type Organization = { id: string; name: string; created_at: string };
type OrganizationMember = { organization_id: string; user_id: string; role: Role; created_at: string };
type PendingInvite = { id: string; organization_id: string; email: string; role: "admin" | "member"; invited_by: string; created_at: string; token_hash?: string | null; expires_at?: string | null };
type Company = {
  id: string;
  organization_id: string;
  name: string;
  website: string | null;
  industry: string | null;
  country: string | null;
  employee_range: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};
type Contact = {
  id: string;
  organization_id: string;
  company_id: string;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  status: string;
  last_contacted_at: string | null;
  next_follow_up: string | null;
  notes: string | null;
  created_at: string;
};
type Activity = {
  id: string;
  organization_id: string;
  company_id: string;
  contact_id: string | null;
  type: string;
  body: string;
  created_by: string;
  created_at: string;
};

type ProspectDossier = {
  id: string;
  organization_id: string;
  domain: string;
  company_name: string;
  sender_website: string;
  industry: string | null;
  country: string | null;
  employee_range: string | null;
  why_fit: string | null;
  opportunity_score: number;
  qualification_summary: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  email_type: string;
  source_url: string | null;
  evidence_map: unknown[];
  trigger_signals: unknown[];
  outreach_sequence: unknown[];
  subject: string;
  body: string;
  stage: string;
  outcome: string;
  company_id: string | null;
  contact_id: string | null;
  last_researched_at: string;
  updated_at: string;
  created_at: string;
};

type PartyEvent = {
  id: string;
  organization_id: string;
  name: string;
  concept: string;
  location: string;
  date_window: string;
  attendance: string;
  vibe: string;
  status: string;
  requirements: string[];
  resources: unknown[];
  notes: string;
  created_by: string;
  updated_by: string;
  updated_at: string;
  created_at: string;
};

type State = {
  users: User[];
  profiles: Profile[];
  organizations: Organization[];
  organization_members: OrganizationMember[];
  pending_invites: PendingInvite[];
  companies: Company[];
  contacts: Contact[];
  activities: Activity[];
  prospect_dossiers: ProspectDossier[];
  party_events: PartyEvent[];
};

type Filter = {
  op: "eq" | "ilike" | "lt" | "gte" | "lte" | "in" | "not";
  column: string;
  value: unknown;
  comparator?: "in" | "is";
};

type Order = { column: string; ascending: boolean; nullsFirst?: boolean };

export type DbRequest = {
  table: keyof Pick<State, "profiles" | "organizations" | "organization_members" | "pending_invites" | "companies" | "contacts" | "activities" | "prospect_dossiers" | "party_events">;
  action: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters?: Filter[];
  orders?: Order[];
  limit?: number;
  range?: [number, number];
  countExact?: boolean;
  head?: boolean;
  mode?: "single" | "maybeSingle";
  returning?: boolean;
};

export type DbResult = {
  data: any;
  error: { message: string; code?: string; details?: string } | null;
  count: number | null;
};

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function emptyState(): State {
  return {
    users: [],
    profiles: [],
    organizations: [],
    organization_members: [],
    pending_invites: [],
    companies: [],
    contacts: [],
    activities: [],
    prospect_dossiers: [],
    party_events: [],
  };
}

async function redis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;
  if (!connectPromise) {
    const url = process.env["REDIS_URL"];
    if (!url) throw new Error("REDIS_URL is not configured.");
    const next = createClient({ url });
    next.on("error", (error) => console.error("[ClientSource datastore]", error));
    connectPromise = next.connect().then(() => {
      client = next as RedisClientType;
      return client;
    });
  }
  return connectPromise;
}

async function readState(): Promise<State> {
  const r = await redis();
  const raw = await r.get(STATE_KEY);
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as Partial<State>;
    return { ...emptyState(), ...parsed } as State;
  } catch {
    throw new Error("ClientSource datastore is unreadable.");
  }
}

async function saveState(state: State): Promise<void> {
  const r = await redis();
  await r.set(STATE_KEY, JSON.stringify(state));
}

async function mutateState<T>(fn: (state: State) => Promise<T> | T): Promise<T> {
  let resolveRun!: (value: T | PromiseLike<T>) => void;
  let rejectRun!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });
  const previous = writeQueue;
  writeQueue = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        const state = await readState();
        const value = await fn(state);
        await saveState(state);
        resolveRun(value);
      } catch (error) {
        rejectRun(error);
      }
    });
  return result;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function inviteExpired(invite: PendingInvite): boolean {
  if (!invite.expires_at) return false;
  const expires = Date.parse(invite.expires_at);
  return Number.isFinite(expires) && expires <= Date.now();
}

function inviteTokenMatches(invite: PendingInvite, token?: string): boolean {
  if (!invite.token_hash) return true;
  if (!token || inviteExpired(invite)) return false;
  const actual = Buffer.from(hashInviteToken(token), "hex");
  const expected = Buffer.from(invite.token_hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function bootstrapAdminInvite(state: State, email: string, token?: string) {
  const configuredEmail = normalizeEmail(process.env["BOOTSTRAP_ADMIN_EMAIL"] ?? "");
  const configuredHash = (process.env["BOOTSTRAP_ADMIN_TOKEN_SHA256"] ?? "").trim().toLowerCase();
  const expiresAt = process.env["BOOTSTRAP_ADMIN_EXPIRES_AT"]?.trim() ?? "";
  if (!configuredEmail || configuredEmail !== email || !configuredHash || !token) return null;
  if (expiresAt) {
    const expires = Date.parse(expiresAt);
    if (Number.isFinite(expires) && expires <= Date.now()) return null;
  }
  const actual = Buffer.from(hashInviteToken(token), "hex");
  const expected = Buffer.from(configuredHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const organization = state.organizations[0];
  return organization ? { organization_id: organization.id, role: "admin" as const } : null;
}

function normalizeWebsite(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, "").replace(/^www\./, "");
  value = value.split("/")[0]!.split("?")[0]!.split("#")[0]!.replace(/\.$/, "");
  return value.includes(".") ? "https://" + value : null;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return "scrypt:" + salt + ":" + digest;
}

function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, digest] = stored.split(":");
  if (kind !== "scrypt" || !salt || !digest) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sessionSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is not configured.");
  return secret;
}

function signToken(user: User): string {
  const body = Buffer.from(
    JSON.stringify({ sub: user.id, email: user.email, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }),
  ).toString("base64url");
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return body + "." + sig;
}

export async function verifySessionToken(token: string): Promise<User | null> {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = createHmac("sha256", sessionSecret()).update(body).digest();
    const actual = Buffer.from(sig, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      sub?: string;
      email?: string;
      exp?: number;
    };
    if (!payload.sub || !payload.exp || payload.exp < Date.now()) return null;
    const state = await readState();
    return state.users.find((u) => u.id === payload.sub) ?? null;
  } catch {
    return null;
  }
}

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    email_confirmed_at: user.created_at,
    created_at: user.created_at,
  };
}

export async function signUp(email: string, password: string, fullName: string, inviteToken?: string) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const user = await mutateState((state) => {
    if (state.users.some((u) => u.email === normalized)) throw new Error("An account with that email already exists.");

    const organization = state.organizations[0] ?? null;
    const invite = state.pending_invites.find((i) => i.email === normalized);
    const bootstrap = bootstrapAdminInvite(state, normalized, inviteToken);

    if (organization && !invite && !bootstrap) throw new Error("INVITE_REQUIRED");
    if (invite?.token_hash) {
      if (inviteExpired(invite)) throw new Error("INVITE_EXPIRED");
      if (!inviteTokenMatches(invite, inviteToken)) throw new Error("INVITE_INVALID");
    }

    const created_at = new Date().toISOString();
    const nextUser: User = { id: randomUUID(), email: normalized, password_hash: hashPassword(password), created_at };
    state.users.push(nextUser);
    state.profiles.push({ id: nextUser.id, full_name: fullName.trim() || null, created_at });

    if (organization) {
      const role: Role = bootstrap?.role ?? invite!.role;
      state.organization_members.push({
        organization_id: bootstrap?.organization_id ?? invite!.organization_id,
        user_id: nextUser.id,
        role,
        created_at,
      });
      if (invite) state.pending_invites = state.pending_invites.filter((i) => i.id !== invite.id);
    }

    return nextUser;
  });
  return { user: publicUser(user), access_token: signToken(user) };
}

export async function signIn(email: string, password: string, inviteToken?: string) {
  const normalized = normalizeEmail(email);
  const state = await readState();
  const user = state.users.find((u) => u.email === normalized);
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error("Invalid email or password.");

  if (inviteToken && !memberFor(state, user.id)) {
    await mutateState((next) => {
      if (memberFor(next, user.id)) return;
      const invite = next.pending_invites.find((i) => i.email === normalized);
      const bootstrap = bootstrapAdminInvite(next, normalized, inviteToken);

      if (invite?.token_hash) {
        if (inviteExpired(invite)) throw new Error("INVITE_EXPIRED");
        if (!inviteTokenMatches(invite, inviteToken)) throw new Error("INVITE_INVALID");
        next.organization_members.push({
          organization_id: invite.organization_id,
          user_id: user.id,
          role: invite.role,
          created_at: new Date().toISOString(),
        });
        next.pending_invites = next.pending_invites.filter((i) => i.id !== invite.id);
        return;
      }

      if (bootstrap) {
        next.organization_members.push({
          organization_id: bootstrap.organization_id,
          user_id: user.id,
          role: bootstrap.role,
          created_at: new Date().toISOString(),
        });
        return;
      }

      if (invite && !invite.token_hash) {
        next.organization_members.push({
          organization_id: invite.organization_id,
          user_id: user.id,
          role: invite.role,
          created_at: new Date().toISOString(),
        });
        next.pending_invites = next.pending_invites.filter((i) => i.id !== invite.id);
        return;
      }

      throw new Error("INVITE_INVALID");
    });
  }

  return { user: publicUser(user), access_token: signToken(user) };
}

export async function userById(userId: string) {
  const state = await readState();
  const user = state.users.find((u) => u.id === userId);
  return user ? publicUser(user) : null;
}

function memberFor(state: State, userId: string) {
  return state.organization_members.find((m) => m.user_id === userId) ?? null;
}

export async function membershipForUser(userId: string) {
  const state = await readState();
  const member = memberFor(state, userId);
  if (!member) return null;
  const org = state.organizations.find((o) => o.id === member.organization_id);
  if (!org) return null;
  return { organizationId: org.id, orgName: org.name, role: member.role, userId };
}

function errorResult(error: unknown): DbResult {
  const e = error as { message?: string; code?: string; details?: string };
  return {
    data: null,
    error: {
      message: e?.message ?? String(error),
      ...(e?.code ? { code: e.code } : {}),
      ...(e?.details ? { details: e.details } : {}),
    },
    count: null,
  };
}

function dbError(message: string, code?: string, details?: string): Error & { code?: string; details?: string } {
  const error = new Error(message) as Error & { code?: string; details?: string };
  if (code) error.code = code;
  if (details) error.details = details;
  return error;
}

function requireMembership(state: State, userId: string) {
  const member = memberFor(state, userId);
  if (!member) throw dbError("NOT_A_MEMBER", "42501");
  return member;
}

function scopedRows(state: State, table: DbRequest["table"], userId: string): any[] {
  const member = memberFor(state, userId);
  if (table === "profiles") {
    if (!member) return state.profiles.filter((p) => p.id === userId);
    const ids = new Set(
      state.organization_members.filter((m) => m.organization_id === member.organization_id).map((m) => m.user_id),
    );
    return state.profiles.filter((p) => ids.has(p.id));
  }
  if (!member) return [];
  if (table === "organizations") return state.organizations.filter((r) => r.id === member.organization_id);
  return (state[table] as any[]).filter((r) => r.organization_id === member.organization_id);
}

function compareFilter(row: any, filter: Filter): boolean {
  const value = row?.[filter.column];
  if (filter.op === "eq") return value === filter.value;
  if (filter.op === "ilike") {
    const needle = String(filter.value ?? "").replace(/^%|%$/g, "").toLowerCase();
    return String(value ?? "").toLowerCase().includes(needle);
  }
  if (filter.op === "lt") return value != null && String(value) < String(filter.value);
  if (filter.op === "gte") return value != null && String(value) >= String(filter.value);
  if (filter.op === "lte") return value != null && String(value) <= String(filter.value);
  if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(value);
  if (filter.op === "not" && filter.comparator === "is") {
    return filter.value === null ? value !== null && value !== undefined : value !== filter.value;
  }
  if (filter.op === "not" && filter.comparator === "in") {
    const values = Array.isArray(filter.value)
      ? filter.value
      : String(filter.value ?? "")
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((v) => v.trim());
    return !values.includes(value);
  }
  return true;
}

function decorate(state: State, table: DbRequest["table"], row: any) {
  const next = { ...row };
  if (table === "contacts") {
    const company = state.companies.find((c) => c.id === row.company_id);
    next.companies = company ? { name: company.name, website: company.website } : null;
  }
  if (table === "organization_members") {
    const org = state.organizations.find((o) => o.id === row.organization_id);
    next.organizations = org ? { name: org.name } : null;
  }
  return next;
}

function applyQuery(state: State, table: DbRequest["table"], rows: any[], request: DbRequest) {
  let out = rows.filter((row) => (request.filters ?? []).every((filter) => compareFilter(row, filter)));
  for (const order of [...(request.orders ?? [])].reverse()) {
    out = [...out].sort((a, b) => {
      const av = a?.[order.column];
      const bv = b?.[order.column];
      if (av == null && bv == null) return 0;
      if (av == null) return order.nullsFirst ? -1 : 1;
      if (bv == null) return order.nullsFirst ? 1 : -1;
      const cmp = String(av).localeCompare(String(bv));
      return order.ascending ? cmp : -cmp;
    });
  }
  const total = out.length;
  if (request.range) out = out.slice(request.range[0], request.range[1] + 1);
  else if (request.limit != null) out = out.slice(0, request.limit);
  const decorated = out.map((row) => decorate(state, table, row));
  if (request.mode === "single") {
    if (decorated.length !== 1) throw dbError("Expected one row, found " + decorated.length + ".");
    return { data: decorated[0], total };
  }
  if (request.mode === "maybeSingle") {
    if (decorated.length > 1) throw dbError("Expected zero or one row, found " + decorated.length + ".");
    return { data: decorated[0] ?? null, total };
  }
  return { data: decorated, total };
}

function withDefaults(table: DbRequest["table"], input: any, userId: string) {
  const now = new Date().toISOString();
  const row = { ...input };
  if (!row.id && table !== "organization_members") row.id = randomUUID();
  if (!row.created_at) row.created_at = now;
  if (table === "companies") {
    row.website = normalizeWebsite(row.website);
    row.status ??= "new";
    row.industry ??= null;
    row.country ??= null;
    row.employee_range ??= null;
    row.notes ??= null;
  }
  if (table === "contacts") {
    row.status ??= "new";
    row.job_title ??= null;
    row.email ??= null;
    row.phone ??= null;
    row.linkedin_url ??= null;
    row.last_contacted_at ??= null;
    row.next_follow_up ??= null;
    row.notes ??= null;
  }
  if (table === "activities") {
    row.contact_id ??= null;
    row.created_by = userId;
  }
  if (table === "party_events") {
    row.name = String(row.name ?? "").trim().slice(0, 200);
    row.concept = String(row.concept ?? "").slice(0, 4000);
    row.location = String(row.location ?? "").slice(0, 300);
    row.date_window = String(row.date_window ?? "").slice(0, 200);
    row.attendance = String(row.attendance ?? "").slice(0, 120);
    row.vibe = String(row.vibe ?? "").slice(0, 1000);
    row.status = ["idea", "shaping", "ready_for_handoff"].includes(String(row.status)) ? String(row.status) : "idea";
    row.requirements = Array.isArray(row.requirements) ? row.requirements.slice(0, 100) : [];
    row.resources = Array.isArray(row.resources) ? row.resources.slice(0, 300) : [];
    row.notes = String(row.notes ?? "").slice(0, 8000);
    row.created_by = userId;
    row.updated_by = userId;
    row.updated_at = now;
  }
  if (table === "prospect_dossiers") {
    row.industry ??= null;
    row.country ??= null;
    row.employee_range ??= null;
    row.why_fit ??= null;
    row.contact_name ??= null;
    row.contact_title ??= null;
    row.contact_email ??= null;
    row.email_type ??= "none";
    row.source_url ??= null;
    row.evidence_map = Array.isArray(row.evidence_map) ? row.evidence_map : [];
    row.trigger_signals = Array.isArray(row.trigger_signals) ? row.trigger_signals : [];
    row.outreach_sequence = Array.isArray(row.outreach_sequence) ? row.outreach_sequence : [];
    row.opportunity_score = Number.isFinite(Number(row.opportunity_score)) ? Math.max(0, Math.min(100, Number(row.opportunity_score))) : 0;
    row.qualification_summary ??= "";
    row.subject ??= "";
    row.body ??= "";
    row.stage ??= "researched";
    row.outcome ??= "unknown";
    row.company_id ??= null;
    row.contact_id ??= null;
    row.last_researched_at ??= now;
    row.updated_at ??= now;
  }
  return row;
}

function canManageRole(actor: OrganizationMember, targetRole: Role | "admin" | "member") {
  return targetRole === "member" ? actor.role === "owner" || actor.role === "admin" : actor.role === "owner";
}

function insertRows(state: State, request: DbRequest, userId: string): any[] {
  const table = request.table;
  const inputs = Array.isArray(request.payload) ? request.payload : [request.payload];
  const inserted: any[] = [];
  for (const raw of inputs) {
    if (!raw || typeof raw !== "object") throw dbError("Invalid record.");
    const row = withDefaults(table, raw, userId);
    if (table === "profiles" || table === "organizations" || table === "organization_members") {
      throw dbError("Permission denied.", "42501");
    }
    if (table === "pending_invites") {
      throw dbError("Use the create_invite action.", "42501");
    } else {
      const actor = requireMembership(state, userId);
      if (row.organization_id !== actor.organization_id) throw dbError("Permission denied.", "42501");
      if (table === "contacts") {
        const company = state.companies.find((c) => c.id === row.company_id && c.organization_id === actor.organization_id);
        if (!company) throw dbError("contacts company reference is invalid", "23503", "contacts");
      }
      if (table === "activities") {
        const company = state.companies.find((c) => c.id === row.company_id && c.organization_id === actor.organization_id);
        if (!company) throw dbError("activities company reference is invalid", "23503");
        if (row.contact_id && !state.contacts.some((c) => c.id === row.contact_id && c.organization_id === actor.organization_id)) {
          throw dbError("activities contact reference is invalid", "23503");
        }
      }
      if (table === "prospect_dossiers") {
        row.domain = String(row.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
        if (!row.domain || !row.domain.includes(".")) throw dbError("prospect dossier domain is invalid", "400");
        row.sender_website = normalizeWebsite(row.sender_website) ?? String(row.sender_website ?? "");
        if (state.prospect_dossiers.some((d) => d.organization_id === actor.organization_id && d.domain === row.domain)) {
          throw dbError("prospect dossier already exists", "23505");
        }
      }
    }
    (state[table] as any[]).push(row);
    inserted.push(row);
  }
  return inserted;
}

function updateRows(state: State, request: DbRequest, userId: string): any[] {
  const table = request.table;
  const patch = (request.payload ?? {}) as Record<string, unknown>;
  const candidates = scopedRows(state, table, userId).filter((row) =>
    (request.filters ?? []).every((filter) => compareFilter(row, filter)),
  );
  const member = memberFor(state, userId);
  if (table === "organization_members") throw dbError("Use the role update action.", "42501");
  if (table === "organizations" && member?.role !== "owner") throw dbError("Permission denied.", "42501");
  if (table === "profiles" && candidates.some((p) => p.id !== userId)) throw dbError("Permission denied.", "42501");
  const allowed = table === "profiles" ? ["full_name"] : null;
  for (const row of candidates) {
    for (const [key, value] of Object.entries(patch)) {
      if (["id", "organization_id", "created_at", "user_id"].includes(key)) continue;
      if (allowed && !allowed.includes(key)) continue;
      row[key] = table === "companies" && key === "website" ? normalizeWebsite(value) : value;
    }
    if (table === "party_events") {
      row.updated_by = userId;
      row.updated_at = new Date().toISOString();
      row.name = String(row.name ?? "").trim().slice(0, 200);
      row.concept = String(row.concept ?? "").slice(0, 4000);
      row.location = String(row.location ?? "").slice(0, 300);
      row.date_window = String(row.date_window ?? "").slice(0, 200);
      row.attendance = String(row.attendance ?? "").slice(0, 120);
      row.vibe = String(row.vibe ?? "").slice(0, 1000);
      row.status = ["idea", "shaping", "ready_for_handoff"].includes(String(row.status)) ? String(row.status) : "idea";
      row.requirements = Array.isArray(row.requirements) ? row.requirements.slice(0, 100) : [];
      row.resources = Array.isArray(row.resources) ? row.resources.slice(0, 300) : [];
      row.notes = String(row.notes ?? "").slice(0, 8000);
    }
  }
  return candidates;
}

function deleteRows(state: State, request: DbRequest, userId: string): any[] {
  const table = request.table;
  const candidates = scopedRows(state, table, userId).filter((row) =>
    (request.filters ?? []).every((filter) => compareFilter(row, filter)),
  );
  const actor = memberFor(state, userId);
  if (!actor) return [];

  if (table === "organization_members") {
    const removed: OrganizationMember[] = [];
    for (const target of candidates as OrganizationMember[]) {
      if (!canManageRole(actor, target.role)) continue;
      if (
        target.role === "owner" &&
        state.organization_members.filter((m) => m.organization_id === actor.organization_id && m.role === "owner").length <= 1
      ) {
        throw dbError("LAST_OWNER: cannot remove the last owner");
      }
      const index = state.organization_members.findIndex(
        (m) => m.organization_id === target.organization_id && m.user_id === target.user_id,
      );
      if (index >= 0) {
        removed.push(target);
        state.organization_members.splice(index, 1);
      }
    }
    return removed;
  }

  if (table === "pending_invites") {
    const removable = (candidates as PendingInvite[]).filter((invite) => canManageRole(actor, invite.role));
    state.pending_invites = state.pending_invites.filter((row) => !removable.some((i) => i.id === row.id));
    return removable;
  }

  if (table === "companies") {
    for (const company of candidates as Company[]) {
      if (state.contacts.some((contact) => contact.company_id === company.id)) {
        throw dbError("contacts still reference this company", "23503", "contacts");
      }
    }
    const companyIds = new Set((candidates as Company[]).map((company) => company.id));
    state.activities = state.activities.filter((activity) => !companyIds.has(activity.company_id));
  }

  if (table === "contacts") {
    const contactIds = new Set((candidates as Contact[]).map((c) => c.id));
    for (const activity of state.activities) if (activity.contact_id && contactIds.has(activity.contact_id)) activity.contact_id = null;
  }

  if (table === "profiles" || table === "organizations") throw dbError("Permission denied.", "42501");

  const ids = new Set(candidates.map((row) => row.id ?? row.organization_id + ":" + row.user_id));
  (state as any)[table] = (state[table] as any[]).filter(
    (row) => !ids.has(row.id ?? row.organization_id + ":" + row.user_id),
  );
  return candidates;
}

export async function executeDbRequest(userId: string, request: DbRequest): Promise<DbResult> {
  try {
    const allowedTables = new Set([
      "profiles",
      "organizations",
      "organization_members",
      "pending_invites",
      "companies",
      "contacts",
      "activities",
      "prospect_dossiers",
      "party_events",
    ]);
    const allowedActions = new Set(["select", "insert", "update", "delete"]);
    if (!allowedTables.has(String(request.table)) || !allowedActions.has(String(request.action))) {
      throw dbError("Invalid data request.", "400");
    }
    if (request.action === "select") {
      const state = await readState();
      const scoped = scopedRows(state, request.table, userId);
      const { data, total } = applyQuery(state, request.table, scoped, request);
      return { data: request.head ? null : data, error: null, count: request.countExact ? total : null };
    }
    return await mutateState((state) => {
      let changed: any[] = [];
      if (request.action === "insert") changed = insertRows(state, request, userId);
      if (request.action === "update") changed = updateRows(state, request, userId);
      if (request.action === "delete") changed = deleteRows(state, request, userId);
      const { data, total } = applyQuery(state, request.table, changed, {
        ...request,
        filters: [],
        range: undefined,
        limit: undefined,
      });
      return {
        data: request.returning ? data : null,
        error: null,
        count: request.countExact ? total : null,
      } as DbResult;
    });
  } catch (error) {
    return errorResult(error);
  }
}

export async function executeRpc(userId: string, fn: string, args: Record<string, unknown> = {}) {
  try {
    const data = await mutateState((state) => {
      const user = state.users.find((u) => u.id === userId);
      if (!user) throw dbError("Not signed in.", "42501");

      if (fn === "workspace_exists") return state.organizations.length > 0;

      if (fn === "create_invite") {
        const actor = requireMembership(state, userId);
        const email = normalizeEmail(String(args["email"] ?? ""));
        const role = String(args["role"] ?? "member") as "admin" | "member";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw dbError("INVALID_EMAIL");
        if (!["admin", "member"].includes(role)) throw dbError("INVALID_ROLE");
        if (!canManageRole(actor, role)) throw dbError("NOT_OWNER");

        const existingUser = state.users.find((u) => u.email === email);
        if (
          existingUser &&
          state.organization_members.some(
            (m) => m.organization_id === actor.organization_id && m.user_id === existingUser.id,
          )
        ) {
          throw dbError("ALREADY_MEMBER");
        }

        const token = randomBytes(32).toString("base64url");
        const expires_at = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
        state.pending_invites = state.pending_invites.filter(
          (i) => !(i.organization_id === actor.organization_id && i.email === email),
        );
        state.pending_invites.push({
          id: randomUUID(),
          organization_id: actor.organization_id,
          email,
          role,
          invited_by: userId,
          created_at: new Date().toISOString(),
          token_hash: hashInviteToken(token),
          expires_at,
        });
        return { email, role, token, expires_at };
      }

      if (fn === "claim_invite") {
        if (memberFor(state, userId)) return null;
        const invite = state.pending_invites.find((i) => i.email === user.email);
        if (!invite || invite.token_hash || inviteExpired(invite)) return null;
        state.organization_members.push({
          organization_id: invite.organization_id,
          user_id: userId,
          role: invite.role,
          created_at: new Date().toISOString(),
        });
        state.pending_invites = state.pending_invites.filter((i) => i.id !== invite.id);
        return null;
      }

      if (fn === "create_workspace") {
        const name = String(args["org_name"] ?? "").trim();
        if (!name) throw dbError("NAME_REQUIRED");
        if (memberFor(state, userId)) throw dbError("ALREADY_MEMBER");
        if (state.organizations.length) throw dbError("WORKSPACE_EXISTS");
        const organization: Organization = { id: randomUUID(), name, created_at: new Date().toISOString() };
        state.organizations.push(organization);
        state.organization_members.push({
          organization_id: organization.id,
          user_id: userId,
          role: "owner",
          created_at: new Date().toISOString(),
        });
        return organization.id;
      }

      if (fn === "set_member_role") {
        const actor = requireMembership(state, userId);
        if (actor.role !== "owner") throw dbError("NOT_OWNER");
        const targetUserId = String(args["target_user_id"] ?? "");
        const newRole = String(args["new_role"] ?? "") as Role;
        if (!["owner", "admin", "member"].includes(newRole)) throw dbError("INVALID_ROLE");
        const target = state.organization_members.find(
          (m) => m.organization_id === actor.organization_id && m.user_id === targetUserId,
        );
        if (!target) throw dbError("NOT_A_MEMBER");
        if (
          target.role === "owner" &&
          newRole !== "owner" &&
          state.organization_members.filter((m) => m.organization_id === actor.organization_id && m.role === "owner").length <= 1
        ) {
          throw dbError("LAST_OWNER: cannot demote the last owner");
        }
        target.role = newRole;
        return null;
      }

      if (fn === "seed_sample_data") {
        const actor = requireMembership(state, userId);
        if (!["owner", "admin"].includes(actor.role)) throw dbError("NOT_ADMIN");
        if (state.companies.some((c) => c.organization_id === actor.organization_id)) throw dbError("ORG_NOT_EMPTY");
        return null;
      }

      throw dbError("Unknown RPC: " + fn);
    });
    return { data, error: null };
  } catch (error) {
    const result = errorResult(error);
    return { data: null, error: result.error };
  }
}


export async function prospectFeedbackForOrganization(organizationId: string) {
  const state = await readState();
  const rows = state.prospect_dossiers.filter((d) => d.organization_id === organizationId && d.outcome !== "unknown");
  const positives = rows.filter((d) => ["replied", "interested", "customer"].includes(d.outcome));
  const negatives = rows.filter((d) => d.outcome === "not_relevant");

  const top = (items: ProspectDossier[], key: "industry" | "employee_range") => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const value = item[key]?.trim();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([value]) => value);
  };

  return {
    samples: rows.length,
    positiveIndustries: top(positives, "industry"),
    positiveEmployeeRanges: top(positives, "employee_range"),
    negativeIndustries: top(negatives, "industry"),
  };
}

export async function datastoreHealth() {
  const r = await redis();
  const probeKey = "clientsource:health:" + randomUUID();
  const probeValue = new Date().toISOString();
  await r.set(probeKey, probeValue, { EX: 30 });
  const readBack = await r.get(probeKey);
  await r.del(probeKey);
  if (readBack !== probeValue) throw new Error("Render datastore write/read verification failed.");
  return { ok: true as const, datastore: "render-key-value" as const };
}
