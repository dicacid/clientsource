import assert from "node:assert/strict";
import test from "node:test";
import {
  businessRouting,
  classifyClosing,
  deterministicTenderKey,
  parseAustralianLocalDate,
  parseConsolidatedTenderText,
  scoreTender,
} from "../src/lib/spa/tenders.ts";

test("normalises a Melbourne tender closing time to UTC", () => {
  assert.equal(
    parseAustralianLocalDate("Wed, 07 October 2026 3:30 pm", "Australia/Melbourne"),
    "2026-10-07T04:30:00.000Z",
  );
});

test("closing intelligence keeps missing dates unknown and classifies urgency", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");
  assert.equal(classifyClosing(null, now), "unknown");
  assert.equal(classifyClosing("2026-10-01T20:00:00.000Z", now), "within_48h");
  assert.equal(classifyClosing("2026-10-05T00:00:00.000Z", now), "within_7d");
  assert.equal(classifyClosing("2026-10-10T00:00:00.000Z", now), "within_14d");
  assert.equal(classifyClosing("2026-11-01T00:00:00.000Z", now), "later");
  assert.equal(classifyClosing("2026-09-30T00:00:00.000Z", now), "expired");
});

test("business routing supports all three businesses independently", () => {
  const fits = businessRouting(
    "Supply of solar PV modules, inverter and battery BESS equipment for an electric vehicle electrification prototype and remote microgrid.",
  );
  const matched = fits.filter((fit) => fit.score >= 20).map((fit) => fit.business).sort();
  assert.deepEqual(matched, ["elmofo", "solaronline", "spa"]);
});

test("deterministic tender identity prefers published source reference", () => {
  const key = deterministicTenderKey({
    sourceName: "Buying for Victoria",
    sourceSpecificId: "329029",
    referenceNumber: "RFT-2026-01",
    sourceUrl: "https://www.tenders.vic.gov.au/tender/view?id=329029",
    issuer: "Example Department",
    tenderTitle: "Battery Storage",
    closingDateRaw: "Wed, 07 October 2026 3:30 pm",
    location: "Victoria",
  });
  assert.equal(key, "buying for victoria rft 2026 01");
});

test("relevance score is explainable and never represented as win probability", () => {
  const fits = businessRouting("Industrial solar PV and BESS microgrid for a remote site");
  const result = scoreTender({
    title: "Industrial solar PV and BESS microgrid",
    summary: "Remote site energy system",
    category: "Renewable energy",
    state: "NSW",
    sourceName: "NSW Government",
    sourceStatus: "open",
    normalizedCloseTimestamp: "2026-10-20T00:00:00.000Z",
    businessFits: fits,
    evidenceCount: 4,
  });
  assert.ok(result.score > 0 && result.score <= 100);
  assert.match(result.explanation, /not probability of winning/i);
  assert.ok(result.factors.length >= 5);
});


test("parses consolidated-government tender pages used by ACT and Victoria", () => {
  const rows = parseConsolidatedTenderText(
    "PICE0014839 Open Expression of Interest Solar carpark with EV Charging Issued by: City and Environment Directorate UNSPSC 1: 72000000 - Building and Facility Construction Released Wed, 30 September 2026 2:00 pm Closing Thu, 19 November 2026 2:00 pm",
    {
      sourceName: "Tenders ACT",
      sourceUrl: "https://www.tenders.act.gov.au/tenders/open",
      timezone: "Australia/Sydney",
      state: "ACT",
      location: "Australian Capital Territory",
    },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].referenceNumber, "PICE0014839");
  assert.equal(rows[0].tenderTitle, "Solar carpark with EV Charging");
  assert.equal(rows[0].issuer, "City and Environment Directorate");
  assert.equal(rows[0].opportunityType, "Expression of Interest");
});
