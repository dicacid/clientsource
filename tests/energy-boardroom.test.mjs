import test from "node:test";
import assert from "node:assert/strict";
import { makeHypothesis, modelPipeline } from "../src/lib/energy/boardroom.ts";

test("commercial pipeline scenario calculation retains explicit assumptions", () => {
  const v=modelPipeline({qualifiedLeads:20,conversionRatePercent:15,averageContractAud:300000,grossMarginPercent:22,costToPursueAud:25000});
  assert.equal(v.expectedDeals,3);
  assert.equal(v.expectedRevenueAud,900000);
  assert.equal(v.expectedGrossProfitAud,198000);
  assert.equal(v.expectedContributionAud,173000);
  assert.ok(Math.abs(v.breakEvenDeals-(25000/66000))<0.00000001);
});
test("invalid pipeline input is rejected", () => {
 const v={qualifiedLeads:20,conversionRatePercent:15,averageContractAud:300000,grossMarginPercent:22,costToPursueAud:25000};
 assert.throws(()=>modelPipeline({...v,grossMarginPercent:101}));
 assert.throws(()=>modelPipeline({...v,conversionRatePercent:-1}));
 assert.throws(()=>modelPipeline({...v,averageContractAud:Number.NaN}));
});
test("nonviable margins correctly produce no break-even count",()=>{
 const v=modelPipeline({qualifiedLeads:10,conversionRatePercent:10,averageContractAud:2000,grossMarginPercent:0,costToPursueAud:300});
 assert.equal(v.breakEvenDeals,null);
 assert.equal(v.expectedContributionAud,-300);
});
test("WA consultation is explicitly not a legal market",()=>{
 const h=makeHypothesis({sector:"installers",model:"supply",policyId:"wa-balcony"});
 assert.match(h.decision,/do not assume commercial sale is permitted/i);
 assert.match(h.firstMove,/consultation/i);
});
test("confirmed federal policy creates a qualification decision, not a guaranteed win",()=>{
 const h=makeHypothesis({sector:"warehousing",model:"epc",policyId:"au-midscale"});
 assert.match(h.decision,/validate/i);
 assert.match(h.firstMove,/do not invent leads/i);
});
