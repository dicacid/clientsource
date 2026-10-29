import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, BadgeCheck, BriefcaseBusiness, ChevronRight, Download, Gauge, Lightbulb, Loader2, Rocket, ShieldAlert } from "lucide-react";
import { makeHypothesis, modelPipeline, type DeliveryModel, type Sector } from "@/lib/energy/boardroom";
import type { PulseSignal, SourceCheck } from "@/lib/energy/market";
export const Route=createFileRoute("/decision-room")({
  head:()=>({meta:[{title:"Decision Room | Energy Market Lab"},{name:"robots",content:"noindex, nofollow"}]}),
  component:DecisionRoom,
});
type Pulse={checkedAt:string;checks:SourceCheck[];signals:PulseSignal[];live:boolean};
type Pipeline={qualifiedLeads:number;conversionRatePercent:number;averageContractAud:number;grossMarginPercent:number;costToPursueAud:number};
const starting:Pipeline={qualifiedLeads:20,conversionRatePercent:15,averageContractAud:300000,grossMarginPercent:22,costToPursueAud:25000};
const sectors:{value:Sector;label:string}[]=[
{value:"warehousing",label:"Warehousing & logistics"},{value:"agriculture",label:"Agriculture & cold chain"},
{value:"manufacturing",label:"Manufacturing"},{value:"installers",label:"Solar installers"}];
const models:{value:DeliveryModel;label:string}[]=[
{value:"epc",label:"Design & installation"},{value:"platform",label:"Software & managed service"},
{value:"finance",label:"Finance & PPA"},{value:"supply",label:"Product distribution"}];
const aud=new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD",maximumFractionDigits:0});
const dec=new Intl.NumberFormat("en-AU",{maximumFractionDigits:1});
const fmt=(v:number)=>aud.format(v);
const stamp=(v:string)=>new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",dateStyle:"medium",timeStyle:"short"}).format(new Date(v));
function DecisionRoom(){
 const [pulse,setPulse]=useState<Pulse|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [policy,setPolicy]=useState("");
 const [sector,setSector]=useState<Sector>("warehousing");
 const [model,setModel]=useState<DeliveryModel>("epc");
 const [inputs,setInputs]=useState<Pipeline>(starting);
 const [business,setBusiness]=useState("");
 useEffect(()=>{
  let mounted=true;
  (async()=>{
   try{
    const res=await fetch("/api/energy/pulse",{cache:"no-store"});
    const result=await res.json() as Pulse;
    if(!mounted)return;
    setPulse(result);
    if(!res.ok)setError("Government sources did not pass verification. Commercial recommendations are locked.");
   }catch(err){if(mounted)setError(err instanceof Error?err.message:"Cannot retrieve live policy evidence.");}
   finally{if(mounted)setLoading(false);}
  })();
  return()=>{mounted=false;};
 },[]);
 const selected=pulse?.signals.find(s=>s.id===policy)??pulse?.signals[0];
 const hypothesis=selected?makeHypothesis({sector,model,policyId:selected.id}):null;
 const numbers=useMemo(()=>{try{return modelPipeline(inputs);}catch{return null;}},[inputs]);
 const workflow=selected?.stage==="consultation" ? [
  ["Days 1–7","Review proposal and draft technical standards; identify unresolved product safety rules."],
  ["Days 8–30","Interview prospective buyers and regulators; submit consultation feedback."],
  ["Days 31–60","Line up contingent manufacturers and compliance testing; do not sell as approved."],
  ["Days 61–90","Re-evaluate only after official legal and standards changes are confirmed."],
 ] : [
  ["Days 1–7","Confirm exact regulatory scope; verify your technical delivery capabilities and commercial constraints."],
  ["Days 8–30","Research and qualify ten real customer decision makers; document their operational pain and energy data."],
  ["Days 31–60","Produce preliminary feasibility and three costed proposals; independently validate incentives."],
  ["Days 61–90","Pursue approved contracts; measure conversion and unit economics, then decide whether to scale."],
 ];
 function edit(k:keyof Pipeline, raw:string){setInputs(v=>({...v,[k]:raw.trim()?Number(raw):NaN}));}
 function exportReport(){
  const output={createdAt:new Date().toISOString(),tool:"Energy Market Lab / Decision Room",
   business:business.trim()||null,sourceStatus:pulse?.checks??[],selectedVerifiedSignal:selected??null,
   marketHypothesis:hypothesis,deliveryModel:model,sector,commercialAssumptions:inputs,
   modelledPipeline:numbers,executionPlan:workflow,
   warning:"Revenue figures are assumption-based, not forecasts, actual contracts or validated customer demand. Legislative signals are drawn only from three predefined official pages."};
  const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download="energy-decision-brief.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
 }
 return <main className="min-h-screen bg-[#090e17] text-slate-100">
  <div className="mx-auto max-w-6xl px-4 py-7 sm:px-7">
   <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
    <div><Link to="/energy" className="inline-flex min-h-11 items-center gap-2 text-sm text-cyan-300"><ArrowLeft size={16}/> Energy Market Lab</Link>
     <div className="mt-2 flex items-center gap-2 font-mono text-xs uppercase tracking-[.18em] text-cyan-300"><BriefcaseBusiness size={16}/> Strategy execution</div>
     <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">The CEO Decision Room</h1>
     <p className="mt-2 text-sm text-slate-400">Verified policy → commercial thesis → deal economics → 90-day execution.</p>
    </div>
    <button type="button" onClick={exportReport} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-400 px-4 font-semibold text-slate-950 hover:bg-cyan-300"><Download size={17}/> Export decision brief</button>
   </header>
   <div className="mt-5 grid gap-4 md:grid-cols-3">
    <div className="rounded-xl border border-white/10 bg-[#121d2b] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400"><BadgeCheck size={16} className="text-cyan-300"/> Verified source events</div>
      <div className="mt-2 text-2xl font-semibold">{loading?"Checking...":pulse?.signals.length??0}</div>
      <p className="mt-2 text-xs text-slate-400">{pulse?.checkedAt?"Checked "+stamp(pulse.checkedAt):"Live check not completed"}</p>
    </div>
    <div className="rounded-xl border border-white/10 bg-[#121d2b] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400"><Gauge size={16} className="text-cyan-300"/> Hypothetical pipeline</div>
      <div className="mt-2 text-2xl font-semibold">{numbers?fmt(numbers.expectedRevenueAud):"—"}</div>
      <p className="mt-2 text-xs text-amber-200">Calculated from editable assumptions, not verified demand</p>
    </div>
    <div className="rounded-xl border border-white/10 bg-[#121d2b] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400"><Rocket size={16} className="text-cyan-300"/> 90-day operating plan</div>
      <div className="mt-2 text-2xl font-semibold">4 phases</div>
      <p className="mt-2 text-xs text-slate-400">Qualify → validate → propose → decision</p>
    </div>
   </div>
   {error&&<div role="alert" className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">{error}</div>}
   <section className="mt-5 rounded-xl border border-white/10 bg-[#121d2b] p-5">
    <div className="font-mono text-xs uppercase tracking-widest text-cyan-300">Executive intelligence · Industry-verified priorities</div>
    <h2 className="mt-2 text-xl font-semibold">What leading energy operators actually care about</h2>
    <p className="mt-2 text-sm text-slate-400">Public executive statements and industry analysis. These are market context, not claims about your company or the person you're meeting.</p>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      {[
        {tag:"CEO / Market expansion",title:"Turn policy timing into a first-mover commercial offer",detail:"Venergy Solar Australia publicly highlights the newly expanded 100 kW–1 MW segment as a meaningful opening for commercial rooftop opportunities.",source:"Venergy Solar Australia · LinkedIn",url:"https://www.linkedin.com/posts/venergysolaraustralia_were-in-last-weeks-the-australian-financial-activity-7503203017928876032-7onx"},
        {tag:"Commercial energy CEO",title:"Customers want integrated energy outcomes",detail:"NRG-ONE CEO Carl Duncan discusses expanding beyond solar-only systems toward storage and flexible loads.",source:"Carl Duncan · LinkedIn",url:"https://au.linkedin.com/in/carl-duncan-energyguy"},
        {tag:"Industry research",title:"Find financeable projects, not impressive-looking leads",detail:"IEEFA identifies complex tariffs, investment barriers and unpredictable grid connection as obstacles holding back Australian business rooftop solar.",source:"IEEFA · June 2026",url:"https://ieefa.org/resources/unlocking-clean-energy-potential-australian-business-rooftops"},
      ].map(item=><article key={item.title} className="rounded-lg border border-white/10 bg-[#18283a] p-4">
       <div className="text-[11px] uppercase tracking-wide text-cyan-300">{item.tag}</div>
       <h3 className="mt-2 text-sm font-semibold leading-6">{item.title}</h3>
       <p className="mt-2 text-xs leading-5 text-slate-300">{item.detail}</p>
       <a href={item.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 text-xs text-cyan-300 underline">{item.source}<ArrowUpRight size={13}/></a>
      </article>)}
    </div>
   </section>
   <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.15fr]">
    <div className="rounded-xl border border-white/10 bg-[#121d2b] p-5">
     <div className="font-mono text-xs uppercase tracking-widest text-cyan-300">01 · Market inflection point</div>
     <h2 className="mt-2 text-xl font-semibold">What changed, and why now?</h2>
     {loading&&<p className="mt-4 flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={17}/> Retrieving government evidence...</p>}
     {pulse?.signals.length ? <><label className="mt-4 block text-sm text-slate-300">Choose a verified policy event
      <select value={selected?.id??""} onChange={e=>setPolicy(e.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-white/20 bg-[#18283a] px-3 text-base text-white">{pulse.signals.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select>
     </label><div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4">
      <div className="mb-2 inline-flex items-center gap-2 text-xs text-emerald-300"><BadgeCheck size={14}/> Verified on official site · {selected?.stage.replace("_"," ")}</div>
      <p className="text-sm leading-6">{selected?.evidence}</p>
      <a href={selected?.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm text-cyan-300 underline">View original government evidence <ArrowUpRight size={16}/></a>
     </div></> : !loading && <div className="mt-4 rounded-lg border border-dashed border-white/20 p-4 text-sm text-amber-200">No events verified. No commercial inference will be presented as a discovered opportunity.</div>}
     <label className="mt-4 block text-sm text-slate-300">Business profile (optional)
      <input value={business} onChange={e=>setBusiness(e.target.value)} maxLength={200} placeholder="Name of your energy business" className="mt-2 min-h-12 w-full rounded-lg border border-white/20 bg-[#18283a] px-3 text-base text-white placeholder:text-slate-500"/>
     </label>
     <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-sm text-slate-300">Target buyer
       <select value={sector} onChange={e=>setSector(e.target.value as Sector)} className="mt-2 min-h-12 w-full rounded-lg border border-white/20 bg-[#18283a] px-2 text-base text-white">{sectors.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select>
       </label><label className="text-sm text-slate-300">Business model
       <select value={model} onChange={e=>setModel(e.target.value as DeliveryModel)} className="mt-2 min-h-12 w-full rounded-lg border border-white/20 bg-[#18283a] px-2 text-base text-white">{models.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select>
       </label></div>
    </div>
    <div className="rounded-xl border border-white/10 bg-[#121d2b] p-5">
      <div className="font-mono text-xs uppercase tracking-widest text-cyan-300">02 · Commercial strategy</div>
      <h2 className="mt-2 text-xl font-semibold">What would we sell, and to whom?</h2>
      {hypothesis ? <div className="mt-4 space-y-4">
       <div><div className="text-xs uppercase text-slate-400">Ideal economic buyer</div><p className="mt-1 text-sm font-medium">{hypothesis.buyer}</p></div>
       <div><div className="text-xs uppercase text-slate-400">Offer to test</div><p className="mt-1 text-sm leading-6">{hypothesis.offer}</p></div>
       <div><div className="text-xs uppercase text-slate-400">Positioning advantage to validate</div><p className="mt-1 text-sm leading-6">{hypothesis.unfairAdvantage}</p></div>
       <div className="rounded-lg border-l-2 border-cyan-400 bg-cyan-500/5 p-3"><div className="text-xs uppercase text-cyan-300">Next concrete move</div><p className="mt-2 text-sm leading-6">{hypothesis.firstMove}</p></div>
       <div className="text-sm font-semibold text-amber-200">{hypothesis.decision}</div>
      </div> : <p className="mt-4 text-sm text-slate-400">A sourced policy observation is required before a market thesis is generated.</p>}
    </div>
   </section>
   <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
    <div className="rounded-xl border border-white/10 bg-[#121d2b] p-5">
     <div className="font-mono text-xs uppercase tracking-widest text-cyan-300">03 · Unit economics</div>
     <h2 className="mt-2 text-xl font-semibold">What could the deal pipeline earn?</h2>
     <p className="mt-2 text-sm text-slate-400">Change the assumptions together in the meeting. No lead, contract or conversion has been verified.</p>
     <div className="mt-5 grid grid-cols-2 gap-3">{([
       ["qualifiedLeads","Qualified leads","1"],["conversionRatePercent","Conversion rate (%)","1"],
       ["averageContractAud","Average deal (AUD)","1000"],["grossMarginPercent","Gross margin (%)","1"],
       ["costToPursueAud","Pursuit cost (AUD)","1000"]
      ] as const).map(([k,label,step])=><label key={k} className="text-xs text-slate-300">{label}
       <input type="number" step={step} value={Number.isNaN(inputs[k])?"":inputs[k]} onChange={e=>edit(k,e.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-white/20 bg-[#18283a] px-3 text-base text-white"/>
      </label>)}</div>
     {!numbers&&<p role="alert" className="mt-4 text-sm text-amber-200">Enter non-negative values; margin and conversion must not exceed 100%.</p>}
     <button type="button" className="mt-4 min-h-11 text-sm text-cyan-300 underline" onClick={()=>setInputs(starting)}>Reset example assumptions</button>
    </div>
    <div className="rounded-xl border border-white/10 bg-[#121d2b] p-5">
     <div className="font-mono text-xs uppercase tracking-widest text-cyan-300">04 · Decision sensitivity</div>
     <h2 className="mt-2 text-xl font-semibold">Is the hypothetical case attractive?</h2>
     <div className="mt-5 grid grid-cols-2 gap-3">
      {[
       ["Expected deals",numbers?dec.format(numbers.expectedDeals):"—"],
       ["Expected gross profit",numbers?fmt(numbers.expectedGrossProfitAud):"—"],
       ["Less pursuit cost",numbers?fmt(inputs.costToPursueAud):"—"],
       ["Contribution after pursuit",numbers?fmt(numbers.expectedContributionAud):"—"]
      ].map(([label,value])=><div key={label} className="rounded-lg border border-white/10 bg-[#18283a] p-3">
        <div className="text-xs text-slate-400">{label}</div><div className="mt-2 break-words text-lg font-semibold">{value}</div>
      </div>)}
     </div>
     <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-4">
      <div className="text-xs uppercase text-cyan-300">Break-even contracts</div>
      <div className="mt-2 text-3xl font-semibold">{numbers?.breakEvenDeals==null?"Not computable":Math.ceil(numbers.breakEvenDeals).toLocaleString("en-AU")}</div>
      <p className="mt-2 text-xs text-slate-300">At the assumed deal size and gross margin; excludes fixed overheads and capital costs.</p>
     </div>
     <p className="mt-4 text-xs leading-5 text-slate-400">This is a deterministic scenario model, not AI-predicted demand. No probit, seasonality or acquisition costs beyond the supplied pursuit cost are inferred.</p>
    </div>
   </section>
   <section className="mt-5 rounded-xl border border-white/10 bg-[#121d2b] p-5">
    <div className="font-mono text-xs uppercase tracking-widest text-cyan-300">05 · Boardroom action plan</div>
    <h2 className="mt-2 text-xl font-semibold">Turn opportunity into a 90-day test</h2>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{workflow.map(([phase,description])=><div key={phase} className="rounded-lg border border-white/10 bg-[#18283a] p-4">
     <div className="flex items-center justify-between text-xs font-semibold text-cyan-300">{phase}<ChevronRight size={16}/></div><p className="mt-3 text-sm leading-6">{description}</p>
    </div>)}</div>
    {hypothesis&&<div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
     <div className="flex items-center gap-2 text-sm font-semibold text-amber-200"><ShieldAlert size={17}/> Proof required before investment or promises</div>
     <ul className="mt-3 grid list-inside list-disc gap-2 text-sm text-slate-300 md:grid-cols-2">{hypothesis.proofRequired.map(p=><li key={p}>{p}</li>)}</ul>
    </div>}
   </section>
   <footer className="py-8 text-xs leading-6 text-slate-500">Energy Market Lab · Revealing Mind AI. Source intelligence currently covers three selected official public pages, not the entire market. Strategy and revenue are explicitly hypotheses. Do not act on regulatory details without independent verification.</footer>
  </div>
 </main>;
}
