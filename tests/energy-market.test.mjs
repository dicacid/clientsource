import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSolarScenario, findVerifiedPolicies } from "../src/lib/energy/market.ts";

test("solar economics accurately calculates generation, savings, and simple payback", () => {
  const result = evaluateSolarScenario({
    sizeKw: 250, generationKwhPerKwYear: 1400, selfUsePercent: 80,
    importedTariffAud: 0.28, exportTariffAud: 0.05,
    installedCostAud: 300000, annualOpexAud: 4000, eligibleIncentiveAud: 0,
  });
  assert.equal(result.generationKwh, 350000);
  assert.equal(result.selfUseKwh, 280000);
  assert.equal(result.exportedKwh, 70000);
  assert.equal(result.annualGrossBenefitAud, 81900);
  assert.equal(result.annualNetBenefitAud, 77900);
  assert.ok(Math.abs(result.simplePaybackYears - 300000 / 77900) < 1e-9);
});
test("no fictional incentive is deducted when none supplied", () => {
  const result = evaluateSolarScenario({
    sizeKw: 50, generationKwhPerKwYear: 1300, selfUsePercent: 90,
    importedTariffAud: 0.25, exportTariffAud: 0,
    installedCostAud: 50000, annualOpexAud: 0, eligibleIncentiveAud: 0,
  });
  assert.equal(result.upfrontNetCostAud, 50000);
});
test("strict rejection of invalid scenario inputs", () => {
  const base = {
    sizeKw: 100, generationKwhPerKwYear: 1400, selfUsePercent: 80,
    importedTariffAud: 0.2, exportTariffAud: 0.05,
    installedCostAud: 100000, annualOpexAud: 0, eligibleIncentiveAud: 0,
  };
  assert.throws(() => evaluateSolarScenario({ ...base, selfUsePercent: 120 }));
  assert.throws(() => evaluateSolarScenario({ ...base, sizeKw: 0 }));
  assert.throws(() => evaluateSolarScenario({ ...base, eligibleIncentiveAud: -1 }));
  assert.equal(evaluateSolarScenario({ ...base, annualOpexAud: 1000000 }).simplePaybackYears, null);
});
test("policy findings require source content; never fake results on failure", () => {
  assert.deepEqual(findVerifiedPolicies({}, "2026-10-29T08:00:00Z"), []);
  assert.deepEqual(findVerifiedPolicies({ cer: "unrelated page" }, "2026-10-29T08:00:00Z"), []);
});
test("matches qualifying government source text while preserving provenance", () => {
  const pulse = findVerifiedPolicies({
    cer: "The SRES expands eligibility from 100 kW to 1 MW for eligible solar systems.",
    nsw: "NSW CER Installer Portal changes from 2 November 2026 for network services.",
    wa: "WA plug-in solar and batteries consultation opened.",
  }, "2026-10-29T08:00:00Z");
  assert.equal(pulse.length, 3);
  assert.ok(pulse.every((signal) => signal.verifiedAt === "2026-10-29T08:00:00Z"));
  assert.equal(pulse[0].stage, "in_force");
  assert.equal(pulse[1].stage, "upcoming");
  assert.equal(pulse[2].stage, "consultation");
});
