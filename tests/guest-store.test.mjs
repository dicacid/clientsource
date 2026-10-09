import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

globalThis.crypto ??= webcrypto;

function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}
globalThis.sessionStorage = storage();

const { executeGuestRequest: query } = await import("../src/integrations/render/guest-store.ts");

const fetchRows = (table, filters = [], extra = {}) => query({ table, action: "select", filters, ...extra });
const add = (table, payload, extra = {}) => query({ table, action: "insert", payload, returning: true, mode: "single", ...extra });
const eq = (column, value) => ({ op: "eq", column, value });

test("new anonymous tab has an empty, independent workspace", () => {
  const a = add("companies", { name: "Tab A", organization_id: "someone-else", owner_user_id: "victim" });
  assert.equal(a.error, null);
  assert.equal(a.data.owner_user_id, "guest");
  assert.equal(a.data.organization_id, "guest");
  assert.equal(fetchRows("companies").data.length, 1);

  globalThis.sessionStorage = storage();
  assert.deepEqual(fetchRows("companies").data, []);
  assert.equal(fetchRows("contacts").data.length, 0);
});

test("guest CRM supports company and contact saves without leaking private records", () => {
  const company = add("companies", { name: "Local Business", status: "new" });
  assert.equal(company.error, null);
  const contact = add("contacts", { company_id: company.data.id, full_name: "Jane Test", status: "new" });
  assert.equal(contact.error, null);
  const rows = fetchRows("contacts", [eq("organization_id", "guest")], { countExact: true });
  assert.equal(rows.count, 1);
  assert.equal(rows.data[0].companies.name, "Local Business");
  assert.equal(fetchRows("contacts", [eq("organization_id", "victim")]).data.length, 0);

  const changed = query({ table: "companies", action: "update", filters: [eq("id", company.data.id)], payload: { status: "qualified", organization_id: "victim", owner_user_id: "victim" } });
  assert.equal(changed.error, null);
  assert.equal(fetchRows("companies", [eq("id", company.data.id)]).data[0].status, "qualified");
  assert.equal(fetchRows("companies", [eq("id", company.data.id)]).data[0].organization_id, "guest");

  const blocked = query({ table: "companies", action: "delete", filters: [eq("id", company.data.id)] });
  assert.match(blocked.error.message, /contacts/i);
});

test("guest research and Party Mode are session-local; member records cannot be changed", () => {
  const dossier = add("prospect_dossiers", { company_name: "Sample Prospect", domain: "example.com", opportunity_score: 32 });
  const party = add("party_events", { name: "Private guest draft", status: "idea" });
  assert.equal(dossier.error, null);
  assert.equal(party.error, null);
  assert.equal(fetchRows("prospect_dossiers").data.length, 1);
  assert.equal(fetchRows("party_events").data[0].created_by, "guest");
  assert.equal(fetchRows("profiles").data.length, 1);
  assert.ok(query({ table: "organization_members", action: "insert", payload: { role: "owner" } }).error);
  assert.equal(fetchRows("pending_invites").data.length, 0);
});

test("guest reads support ordering, counts, search and pagination", () => {
  add("companies", { name: "A Plumbing", status: "new" });
  add("companies", { name: "B Electrical", status: "qualified" });
  const all = fetchRows("companies", [], { orders: [{ column: "name", ascending: false }], countExact: true, range: [0, 0] });
  assert.ok(all.count >= 2);
  assert.equal(all.data.length, 1);
  const selected = fetchRows("companies", [{ op: "ilike", column: "name", value: "%Electrical%" }]);
  assert.equal(selected.data.length, 1);
  const counts = fetchRows("companies", [eq("status", "qualified")], { head: true, countExact: true });
  assert.equal(counts.data, null);
  assert.ok(counts.count >= 1);
});
