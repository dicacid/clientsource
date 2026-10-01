import assert from "node:assert/strict";
import test from "node:test";
import {
  analyseBusinessFit,
  assignedBusinesses,
  canonicalIdentityCandidates,
  classifyClosingDate,
  parseAustralianDate,
  scoreTender,
} from "../src/lib/spa/tender-core.ts";
import { parseVictoriaListHtml } from "../src/lib/spa/tender-source-parsers.ts";

test("normalises Australian local tender times to UTC", () => {
  assert.equal(
    parseAustralianDate("Wed, 07 October 2026 3:30 pm", "Australia/Melbourne"),
    "2026-10-07T04:30:00.000Z",
  );
});

test("classifies closing windows without inventing missing dates", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");
  assert.equal(classifyClosingDate(null, now), "unknown");
  assert.equal(classifyClosingDate("2026-10-01T20:00:00.000Z", now), "within_48_hours");
  assert.equal(classifyClosingDate("2026-10-05T00:00:00.000Z", now), "within_7_days");
  assert.equal(classifyClosingDate("2026-10-10T00:00:00.000Z", now), "within_14_days");
  assert.equal(classifyClosingDate("2026-11-10T00:00:00.000Z", now), "later");
  assert.equal(classifyClosingDate("2026-09-30T00:00:00.000Z", now), "expired");
});

test("routes one tender independently across all three businesses", () => {
  const tender = {
    title: "Supply and installation of solar battery BESS and electric vehicle electrification equipment",
    issuer: "Example Council",
    summary: "Procurement of PV modules, inverter equipment, battery packs, BESS and specialist EV engineering.",
    category: "Renewable energy equipment",
    country: "Australia",
    state: "NSW",
    location: "Newcastle NSW",
    sourceName: "NSW Government",
    sourceSpecificId: "ABC-123",
    referenceNumber: "ABC-123",
    canonicalSourceUrl: "https://example.gov.au/tender/abc-123",
    sourceStatus: "open",
    normalizedCloseTimestamp: "2026-10-12T06:00:00.000Z",
    evidence: [
      { statement: "Official source states the scope.", sourceUrl: "https://example.gov.au/tender/abc-123", classification: "OBSERVED_FACT" },
    ],
  };
  const fits = analyseBusinessFit(tender);
  assert.deepEqual(assignedBusinesses(fits).sort(), ["elmofo", "solaronline", "spa"]);
  const score = scoreTender(tender, fits, new Date("2026-10-01T00:00:00.000Z"));
  assert.ok(score.score > 0 && score.score <= 100);
  assert.match(score.explanation, /not a probability of winning/i);
});

test("builds deterministic source, reference and URL identity keys", () => {
  const keys = canonicalIdentityCandidates({
    title: "Battery Storage Supply",
    issuer: "Example Agency",
    sourceName: "Tenders VIC",
    sourceSpecificId: "329029",
    referenceNumber: "RFT-2026-1",
    canonicalSourceUrl: "https://www.tenders.vic.gov.au/tender/view?id=329029",
    normalizedCloseTimestamp: "2026-10-10T01:00:00.000Z",
    location: "Victoria",
  });
  assert.ok(keys.includes("source:tenders vic:329029"));
  assert.ok(keys.includes("ref:tenders vic:rft 2026 1"));
  assert.ok(keys.some((key) => key.startsWith("url:https://www.tenders.vic.gov.au/")));
});

test("parses Tenders VIC list records into the canonical source shape", () => {
  const html = [
    "<div>RFQ-2026-44 Open Request for Tender ",
    '<a href="/tender/view?id=329029">Solar and Battery Storage Upgrade</a>',
    " Issued by: Example Department UNSPSC: 26111600 Solar generators",
    " Opened Wed, 30 September 2026 9:00 am",
    " Closing Wed, 07 October 2026 3:30 pm</div>",
  ].join("");
  const rows = parseVictoriaListHtml(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceName, "Tenders VIC");
  assert.equal(rows[0].sourceSpecificId, "329029");
  assert.equal(rows[0].issuer, "Example Department");
  assert.equal(rows[0].normalizedCloseTimestamp, "2026-10-07T04:30:00.000Z");
});

test("source failure isolation contract is represented by independent identity", () => {
  const a = canonicalIdentityCandidates({
    title: "One",
    issuer: "Issuer",
    sourceName: "Source A",
    sourceSpecificId: "1",
    canonicalSourceUrl: "https://a.example/1",
  });
  const b = canonicalIdentityCandidates({
    title: "Two",
    issuer: "Issuer",
    sourceName: "Source B",
    sourceSpecificId: "2",
    canonicalSourceUrl: "https://b.example/2",
  });
  assert.equal(a.some((key) => new Set(b).has(key)), false);
});
