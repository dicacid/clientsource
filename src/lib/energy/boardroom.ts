/** Transparent commercial hypothesis generation. This is not a market-data forecast. */
export type DeliveryModel = "epc" | "platform" | "finance" | "supply";
export type Sector = "warehousing" | "agriculture" | "manufacturing" | "installers";
export type Hypothesis = {
  title: string; buyer: string; offer: string; unfairAdvantage: string;
  firstMove: string; proofRequired: string[]; decision: string;
};
const buyers: Record<Sector,string> = {
  warehousing: "Warehouse owners, logistics asset managers and 3PL operators with daytime energy loads",
  agriculture: "Irrigation operators, packhouses, cold-chain farms and food processors",
  manufacturing: "Plant managers and CFOs at daytime-load industrial facilities",
  installers: "Accredited installation businesses navigating new compliance workflows",
};
const offers: Record<DeliveryModel,string> = {
  epc: "Site-screening, load study, grid-connection review, compliant solar and BESS design, and a staged EPC proposal",
  platform: "Compliance readiness assessment, opportunity intelligence, installer workflow support and auditable reporting",
  finance: "Feasibility screening, development capital assessment, PPA/lease modelling and credit-approved funding structure",
  supply: "Approved-component sourcing, installer enablement, supply warranties and standards-aligned procurement",
};
const advantages: Record<DeliveryModel,string> = {
  epc: "Turn a policy change into a scoped engineering offer while competitors are still selling generic panels",
  platform: "Turn regulatory complexity into a recurring, auditable workflow rather than one-off advice",
  finance: "Use project economics and compliance gates to qualify capital deployment rather than funding speculative leads",
  supply: "Establish a verified channel position early, subject to equipment approval and legal sale requirements",
};
export function makeHypothesis(input:{sector:Sector;model:DeliveryModel;policyId:string}):Hypothesis {
  const {sector, model, policyId}=input;
  const timing=policyId==="au-midscale" ?
    "The expanded mid-scale solar incentive is in force for eligible installations from 1 October 2026." :
    policyId==="nsw-install" ?
    "NSW's new installer portal requirements take effect in phases in November 2026." :
    policyId==="wa-balcony" ?
    "WA's plug-in solar and storage legal pathway is only under consultation, not an enacted market." :
    "No matching verified policy selected.";
  const decision=policyId==="wa-balcony" ? "Prepare and validate, do not assume commercial sale is permitted" :
    policyId==="nsw-install" ? "Qualify installer readiness and timing before offering a service" :
    policyId==="au-midscale" ? "Validate eligible customer load and project feasibility, then pursue qualified projects" :
    "Do not act without sourced policy evidence.";
  return {
    title: `Opportunity thesis: ${buyers[sector]}`,
    buyer: buyers[sector],
    offer: offers[model],
    unfairAdvantage: advantages[model],
    firstMove: `${timing} Identify ten real decision makers in the chosen segment, verify their energy problem and current solution, and offer a short paid discovery or qualification process. Do not invent leads.`,
    proofRequired: [
      "Documented customer load and site demand",
      "Technical feasibility, connection/export constraints and current network requirements",
      "Confirmed delivery capability, insurance, accreditations and approved products",
      "Customer acquisition costs and verified procurement timeline",
      "Validated cost, margin, finance assumptions and incentive eligibility",
    ],
    decision,
  };
}
export function modelPipeline(input:{
  qualifiedLeads:number;conversionRatePercent:number;averageContractAud:number;
  grossMarginPercent:number;costToPursueAud:number;
}) {
  const values=Object.values(input);
  if (values.some(v=>!Number.isFinite(v)||v<0) || input.qualifiedLeads>1000000 ||
    input.conversionRatePercent>100 || input.grossMarginPercent>100 ||
    input.averageContractAud>10000000000 || input.costToPursueAud>10000000000) {
    throw new Error("Enter finite, non-negative commercial assumptions. Percentages cannot exceed 100.");
  }
  const expectedDeals=input.qualifiedLeads*input.conversionRatePercent/100;
  const expectedRevenueAud=expectedDeals*input.averageContractAud;
  const expectedGrossProfitAud=expectedRevenueAud*input.grossMarginPercent/100;
  const expectedContributionAud=expectedGrossProfitAud-input.costToPursueAud;
  const breakEvenDeals=input.averageContractAud*input.grossMarginPercent>0 ?
    input.costToPursueAud/(input.averageContractAud*input.grossMarginPercent/100) : null;
  return {expectedDeals,expectedRevenueAud,expectedGrossProfitAud,expectedContributionAud,breakEvenDeals};
}
