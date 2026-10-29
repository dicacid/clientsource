/**
 * Independent public-procurement reader adapted from SPA's tested pure parsers.
 * This module does not import SPA accounts, Redis stores, saved client records,
 * capability claims, API keys or customer-identifying data.
 */
import {
  parseNswOpportunityText,
  parseTasmanianOpenTenderText,
  parseConsolidatedTenderText,
  deterministicTenderKey,
  parseAustralianLocalDate,
  classifyClosing,
  type RawTender,
} from "../spa/tenders";

export type EnergyTender = {
  id: string; title: string; issuer: string; sourceName: string; sourceUrl: string;
  sourceStatus: "open" | "closed" | "withdrawn" | "awarded" | "unknown";
  reference: string | null; state: string | null; location: string | null;
  publishedDate: string | null; closingDate: string | null; closeBand: string;
  summary: string | null; relevanceScore: number; reasons: string[];
  evidence: { kind: "OBSERVED_SOURCE" | "INFERENCE"; description: string }[];
};
export type TenderSourceCheck = { sourceId: string; sourceName: string; sourceUrl: string; status: "parsed" | "unavailable" | "no_records"; retrieved: number; error: string | null; checkedAt: string };
type Source = { id: string; name: string; url: string; timezone: string; parse: (html: string, url: string) => RawTender[] };
function decode(input: string, lines: boolean) {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, lines ? "\n" : " ")
    .replace(/<[^>]*>/g, lines ? "\n" : " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(lines ? /[ \t]+/g : /\s+/g, " ")
    .trim();
}
const SOURCES: Source[] = [
  { id: "nsw", name: "buy.nsw Opportunities Hub", url: "https://buy.nsw.gov.au/opportunity/search?types=Tenders&page=0", timezone: "Australia/Sydney", parse: (html,url) => parseNswOpportunityText(decode(html,true),url) },
  { id: "vic", name: "Buying for Victoria", url: "https://www.tenders.vic.gov.au/tenders/open?page=1", timezone: "Australia/Melbourne", parse: (html,url) => parseConsolidatedTenderText(decode(html,false),{sourceName:"Buying for Victoria",sourceUrl:url,timezone:"Australia/Melbourne",state:"VIC",location:"Victoria"}) },
  { id: "act", name: "Tenders ACT", url: "https://www.tenders.act.gov.au/tenders/open", timezone: "Australia/Sydney", parse: (html,url) => parseConsolidatedTenderText(decode(html,false),{sourceName:"Tenders ACT",sourceUrl:url,timezone:"Australia/Sydney",state:"ACT",location:"Australian Capital Territory"}) },
  { id: "tas", name: "Tasmanian Government Tenders", url: "https://www.tenders.tas.gov.au/OpenForBids/List/Public/ClosingDate", timezone: "Australia/Hobart", parse: (html,url) => parseTasmanianOpenTenderText(decode(html,true),url) },
];
const MATCHERS: Array<{re:RegExp;reason:string;points:number}> = [
  {re:/\bsolar\b|photovoltaic|\bPV (?:system|installation|array)\b/i,reason:"Solar generation",points:30},
  {re:/\bbess\b|battery energy storage|energy storage system/i,reason:"Battery energy storage",points:30},
  {re:/\bmicrogrid\b|off.grid|remote power|hybrid (?:solar|power|energy)/i,reason:"Remote or hybrid power",points:28},
  {re:/EV charging|electric vehicle charg|fleet electrification/i,reason:"EV charging and electrification",points:22},
  {re:/renewable energy|grid connection|distributed energy/i,reason:"Distributed or renewable energy",points:18},
  {re:/electrical infrastructure|power station|switchgear|power distribution/i,reason:"Electrical power infrastructure",points:14},
  {re:/\binverter\b|battery system|energy efficiency|demand response/i,reason:"Energy equipment or efficiency",points:12},
];
export function qualifyEnergyTender(row: RawTender, checkedAt = new Date().toISOString()): EnergyTender | null {
  const text = [row.tenderTitle,row.summary??"",row.category??""].join(" ").slice(0,8000);
  const match=MATCHERS.filter(m=>m.re.test(text));
  if (!match.length) return null;
  const closingDate=parseAustralianLocalDate(row.closingDateRaw,row.timezone??"Australia/Sydney");
  const closeBand=classifyClosing(closingDate,new Date(checkedAt));
  // Never return an expired, withdrawn or awarded tender as a live lead.
  if (row.sourceStatus==="closed" || row.sourceStatus==="withdrawn" || row.sourceStatus==="awarded" || closeBand==="expired") return null;
  const score=Math.min(100,match.reduce((sum,m)=>sum+m.points,0));
  const id=deterministicTenderKey(row);
  return {
    id, title:row.tenderTitle, issuer:row.issuer, sourceName:row.sourceName,
    sourceUrl:row.sourceUrl, reference:row.referenceNumber, state:row.state,
    location:row.location, publishedDate:parseAustralianLocalDate(row.publishedDateRaw,row.timezone??"Australia/Sydney"),
    closingDate, closeBand, sourceStatus:row.sourceStatus, summary:row.summary,
    relevanceScore:score, reasons:match.map(m=>m.reason),
    evidence:[
      {kind:"OBSERVED_SOURCE",description:"Tender title and metadata extracted from the referenced public procurement listing. Check the issuing authority for latest status."},
      {kind:"INFERENCE",description:"Energy relevance is a keyword-based screening score, not a bid-win probability or validated capability fit."},
    ],
  };
}
let cache: {until:number; data:Awaited<ReturnType<typeof scanLiveEnergyTenders>>}|null=null;
export async function scanLiveEnergyTenders() {
  if(cache && Date.now()<cache.until)return cache.data;
  const checkedAt=new Date().toISOString();
  const fetched=await Promise.all(SOURCES.map(async source=>{
    try {
      const response=await fetch(source.url,{
        signal:AbortSignal.timeout(11000),redirect:"manual",
        headers:{"Accept":"text/html,application/xhtml+xml","User-Agent":"EnergyMarketLab/1.0 (public procurement monitor)"},
      });
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      if(!(response.headers.get("content-type")??"").includes("html")) throw new Error("Unexpected content type");
      const html=(await response.text()).slice(0,3000000);
      const rows=source.parse(html,source.url).slice(0,250);
      return {
        rows,
        check:{sourceId:source.id,sourceName:source.name,sourceUrl:source.url,
          status:rows.length?"parsed" as const:"no_records" as const,
          retrieved:rows.length,error:rows.length?null:"No structured tenders parsed; source may have changed.",checkedAt},
      };
    } catch(error) {
      return { rows:[] as RawTender[], check:{sourceId:source.id,sourceName:source.name,sourceUrl:source.url,
        status:"unavailable" as const,retrieved:0,error:error instanceof Error?error.message.slice(0,160):"Retrieval failed",checkedAt} };
    }
  }));
  const byId=new Map<string,EnergyTender>();
  for(const result of fetched) for(const row of result.rows){
    const tender=qualifyEnergyTender(row,checkedAt);
    if(tender && !byId.has(tender.id))byId.set(tender.id,tender);
  }
  const tenders=[...byId.values()].sort((a,b)=>b.relevanceScore-a.relevanceScore).slice(0,100);
  const data={checkedAt,tenders,checks:fetched.map(r=>r.check),mode:"public_source_screening",note:"Only four selected public tender listing pages are retrieved. Source pages can block automated access. Relevance is heuristic and not a forecast. No company or customer data is used."};
  cache={until:Date.now()+120000,data};
  return data;
}
