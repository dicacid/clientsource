import { createServerFn } from "@tanstack/react-start";
import { datastoreHealth } from "@/integrations/render/state.server";
import { businessRouting, classifyClosing, deterministicTenderKey, parseAustralianLocalDate } from "@/lib/spa/tenders";

function tenderCoreHealth() {
  const parsed = parseAustralianLocalDate("Mon, 26 October 2026 10:00 am");
  const closing = classifyClosing("2026-10-03T00:00:00.000Z", new Date("2026-10-01T00:00:00.000Z"));
  const routing = businessRouting("Supply and delivery of solar battery inverter equipment for EV electrification");
  const base = {
    sourceName: "test",
    sourceSpecificId: "ABC-123",
    referenceNumber: "ABC-123",
    sourceUrl: "https://example.invalid/tender/ABC-123",
    issuer: "Example Agency",
    tenderTitle: "Solar battery supply",
    closingDateRaw: "Mon, 26 October 2026 10:00 am",
    location: "VIC",
  };
  const keyA = deterministicTenderKey(base);
  const keyB = deterministicTenderKey({ ...base, tenderTitle: "Changed display title" });
  const checks = {
    timezoneNormalisation: parsed === "2026-10-25T23:00:00.000Z",
    closingBand: closing === "within_48h",
    deterministicIdentity: keyA === keyB,
    routesSpa: routing.find((item) => item.business === "spa")!.score > 0,
    routesSolarOnline: routing.find((item) => item.business === "solaronline")!.score > 0,
    routesElmofo: routing.find((item) => item.business === "elmofo")!.score > 0,
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

export const healthCheck = createServerFn({ method: "GET" }).handler(async () => {
  const datastore = await datastoreHealth();
  const tenderCore = tenderCoreHealth();
  return {
    ok: datastore.ok && tenderCore.ok,
    service: "spa-intelligence",
    hosting: "render",
    datastore,
    tenderCore,
    environmentAiFallbackConfigured: Boolean(process.env["OPENROUTER_API_KEY"]),
    openRouterByokSupported: true,
  };
});
