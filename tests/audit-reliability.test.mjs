import assert from "node:assert/strict";
import test from "node:test";
import { parseQueenslandPipelineCsv, normalizeQueenslandPipeline, retrieveQueenslandPipeline } from "../src/lib/spa/qld-procurement.server.ts";
import { supportsResearchChat } from "../src/lib/spa/model-compatibility.ts";
import { validateOpenRouterKey } from "../src/lib/spa/openrouter-key.server.ts";
import { requestJsonResponse } from "../src/lib/spa/json-response.server.ts";
import { mapConcurrent, isStaleScan } from "../src/lib/spa/scan-runtime.ts";
import { parseAustralianLocalDate } from "../src/lib/spa/tenders.ts";
import { createRedisConnection } from "../src/integrations/render/redis.server.ts";

const pipeline = '\uFEFFAgency,Program Description,Category Group,Category,Procurement Method,Spend Range\r\nEnergy Agency,"Solar, battery and inverter supply",Goods,Energy equipment,Open tender,$1M - $5M\nAnother Agency,Office stationery,Goods,Stationery,Open tender,Less than $1M\n';

test("Queensland mixed-line-ending CSV produces every row without relying on _id", () => {
  const rows = parseQueenslandPipelineCsv(pipeline);
  assert.equal(rows.length, 2);
  const tenders = normalizeQueenslandPipeline(rows, "test-resource");
  assert.equal(tenders.length, 1);
  assert.equal(tenders[0].tenderTitle, "Solar, battery and inverter supply");
  assert.equal(tenders[0].sourceStatus, "unknown");
  assert.equal(tenders[0].closingDateRaw, null);
  assert.equal(tenders[0].documentedContractValue, null);
  assert.match(tenders[0].summary, /Published estimated spend range/);
});

test("Queensland identity survives datastore row renumbering and spend updates", () => {
  const rows = parseQueenslandPipelineCsv(pipeline);
  const a = normalizeQueenslandPipeline(rows.map(row => ({ ...row, _id: 1 })), "first");
  const b = normalizeQueenslandPipeline(rows.map(row => ({ ...row, _id: 999, "Spend Range": "$5M - $10M" })), "second");
  assert.equal(a[0].sourceSpecificId, b[0].sourceSpecificId);
});

test("Queensland parser rejects empty, HTML and truncated CSV bodies", () => {
  for (const input of ["", "<html>Access denied</html>", 'Agency,Program Description\nAgency,"Unfinished']) {
    assert.throws(() => parseQueenslandPipelineCsv(input));
  }
});

test("Queensland fallback discovers the published CSV URL instead of fixing a month in code", async (t) => {
  const id = "d3968658-dbb7-4732-bc19-467c49de23de";
  const url = "https://www.data.qld.gov.au/dataset/current/resource/" + id + "/download/pipeline-new.csv";
  const calls = [];
  t.mock.method(globalThis, "fetch", async (target) => {
    calls.push(String(target));
    if (String(target).includes("package_show")) return Response.json({ result: { resources: [{ id, name: "Forward procurement pipeline", format: "CSV", url }] } });
    if (String(target).includes("datastore/dump")) return new Response("");
    if (String(target) === url) return new Response(pipeline);
    throw new Error("Unexpected fallback URL");
  });
  const rows = await retrieveQueenslandPipeline();
  assert.equal(rows.length, 1);
  assert.deepEqual(calls.slice(-1), [url]);
});

test("unavailable Queensland feeds use dated source data with unknown availability", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(""));
  t.mock.method(Date, "now", () => Date.parse("2026-10-01T12:00:00Z"));
  const rows = await retrieveQueenslandPipeline();
  assert.equal(rows.length, 21);
  assert.ok(rows.every(row => row.retrievalMethod === "cached" && row.sourceRetrievedAt === "2026-10-01" && row.sourceStatus === "unknown" && row.closingDateRaw === null));
});

test("an expired Queensland snapshot is rejected when live retrieval fails", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(""));
  t.mock.method(Date, "now", () => Date.parse("2026-11-02T12:00:00Z"));
  await assert.rejects(retrieveQueenslandPipeline(), /too old to use/);
});

test("interactive research excludes batch and non-text models", () => {
  assert.equal(supportsResearchChat({ id: "openai/gpt-6-luna-pro:batch", outputModalities: ["text"] }), false);
  assert.equal(supportsResearchChat({ id: "provider/image", outputModalities: ["image"] }), false);
  assert.equal(supportsResearchChat({ id: "provider/chat", outputModalities: ["text"] }), true);
});

test("batch selections fail before submitting a research request", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not submit"); });
  await assert.rejects(requestJsonResponse({ apiKey: "test", model: "openai/gpt-6-luna-pro:batch", system: "test", user: "test" }), /batch model/);
  assert.equal(calls, 0);
});

test("API key validation uses the authenticated key endpoint and rejects invalid keys", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/key");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    return Response.json({ error: { message: "User not found" } }, { status: 401 });
  });
  await assert.rejects(validateOpenRouterKey("test-key"), /rejected/);
});

test("inference keys validate, while management keys cannot be saved for research", async (t) => {
  let management = false;
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: { is_management_key: management } }));
  await validateOpenRouterKey("test-key");
  management = true;
  await assert.rejects(validateOpenRouterKey("test-key"), /inference key/);
});

test("source retrieval bounds concurrency and retains results despite completion order", async () => {
  let active = 0, peak = 0;
  const results = await mapConcurrent([1, 2, 3, 4, 5, 6], 3, async value => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return value * 2;
  });
  assert.equal(peak, 3);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
});

test("only abandoned running scans become stale after their lease", () => {
  const now = Date.parse("2026-10-01T10:30:00Z");
  assert.equal(isStaleScan({ state: "running", startedAt: "2026-10-01T10:14:00Z" }, now), true);
  assert.equal(isStaleScan({ state: "running", startedAt: "2026-10-01T10:25:00Z" }, now), false);
  assert.equal(isStaleScan({ state: "success", startedAt: "2026-10-01T10:14:00Z" }, now), false);
});

test("unqualified ISO and date-only deadlines use the source timezone", () => {
  assert.equal(parseAustralianLocalDate("2026-10-07T15:30:00", "Australia/Sydney"), "2026-10-07T04:30:00.000Z");
  assert.equal(parseAustralianLocalDate("2026-10-07", "Australia/Brisbane"), "2026-10-06T14:00:00.000Z");
  assert.equal(parseAustralianLocalDate("2026-10-07T15:30:00+10:00", "Australia/Sydney"), "2026-10-07T05:30:00.000Z");
});

test("invalid calendar days, timezones and nonexistent daylight-saving times remain unknown", () => {
  assert.equal(parseAustralianLocalDate("31/02/2026 10:00 am"), null);
  assert.equal(parseAustralianLocalDate("07/10/2026 00:00 pm"), null);
  assert.equal(parseAustralianLocalDate("2026-10-07T15:30:00", "Unverified/Timezone"), null);
  assert.equal(parseAustralianLocalDate("2026-10-04T02:30:00", "Australia/Sydney"), null);
});

test("a failed datastore connection can recover on the next request", async (t) => {
  t.mock.method(console, "error", () => {});
  const previous = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://test.invalid";
  t.after(() => { if (previous === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous; });
  let attempts = 0;
  const get = createRedisConnection("test", () => ({
    isOpen: true, on() {}, destroy() {},
    async connect() { if (++attempts === 1) throw new Error("temporary failure"); },
  }));
  await assert.rejects(get(), /temporarily unavailable/);
  const recovered = await get();
  assert.equal(recovered.isOpen, true);
  assert.equal(attempts, 2);
});

test("parallel datastore reads share one connection attempt", async (t) => {
  const previous = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://test.invalid";
  t.after(() => { if (previous === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous; });
  let attempts = 0;
  const get = createRedisConnection("test", () => ({
    isOpen: true, on() {}, destroy() {},
    async connect() { attempts++; await new Promise(resolve => setImmediate(resolve)); },
  }));
  const connections = await Promise.all([get(), get(), get()]);
  assert.equal(attempts, 1);
  assert.equal(connections[0], connections[2]);
});
