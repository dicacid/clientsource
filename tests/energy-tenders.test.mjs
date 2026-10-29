import test from "node:test";
import assert from "node:assert/strict";
import { qualifyEnergyTender } from "../src/lib/energy/tenders.ts";

const row={
 sourceName:"Public procurement test source",sourceSpecificId:"REF-001",
 sourceUrl:"https://www.tenders.vic.gov.au/tenders/open",
 tenderTitle:"Solar battery microgrid design and installation",
 issuer:"Example issuer",referenceNumber:"REF-001",opportunityType:"Open tender",
 category:"Energy",summary:"Battery energy storage for remote facility",
 publishedDateRaw:"2026-10-20",closingDateRaw:"2026-11-20 12:00",
 timezone:"Australia/Melbourne",country:"Australia",state:"VIC",location:"Victoria",
 documentedContractValue:null,tenderDocumentLinks:[],sourceStatus:"open",
};
const checkedAt="2026-10-29T07:00:00.000Z";
test("SPA-derived parser logic qualifies explicit energy projects without inventing bid-win odds",()=>{
 const tender=qualifyEnergyTender(row,checkedAt);
 assert.ok(tender);
 assert.ok(tender.relevanceScore>0);
 assert.ok(tender.relevanceScore<=100);
 assert.equal(tender.issuer,"Example issuer");
 assert.equal(tender.sourceStatus,"open");
 assert.ok(tender.evidence.some(e=>e.kind==="INFERENCE"));
});
test("unrelated procurements do not become invented solar leads",()=>{
 const tender=qualifyEnergyTender({...row,tenderTitle:"Office carpeting and stationery",summary:"General office supplies",category:"Procurement"},checkedAt);
 assert.equal(tender,null);
});
test("expired contracts are not treated as current leads",()=>{
 const tender=qualifyEnergyTender({...row,closingDateRaw:"2026-10-01 12:00"},checkedAt);
 assert.equal(tender,null);
});
test("withdrawn and awarded contracts are excluded even when energy-related",()=>{
 assert.equal(qualifyEnergyTender({...row,sourceStatus:"withdrawn"},checkedAt),null);
 assert.equal(qualifyEnergyTender({...row,sourceStatus:"awarded"},checkedAt),null);
});
