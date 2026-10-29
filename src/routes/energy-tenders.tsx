import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, BadgeCheck, CircleAlert, Download, Loader2, RefreshCw, Search } from "lucide-react";
import type { EnergyTender, TenderSourceCheck } from "@/lib/energy/tenders";

export const Route=createFileRoute("/energy-tenders")({
  head:()=>({meta:[{title:"Energy Tenders | Energy Market Lab"},{name:"robots",content:"noindex, nofollow"}]}),
  component:EnergyTenders,
});
type Result={checkedAt:string;tenders:EnergyTender[];checks:TenderSourceCheck[];note:string};
const formats=new Intl.DateTimeFormat("en-AU",{dateStyle:"medium",timeZone:"Australia/Sydney"});
function fmtDate(s:string|null){if(!s)return "Not published";const ts=Date.parse(s);return Number.isFinite(ts)?formats.format(new Date(ts)):"Not published";}
function EnergyTenders(){
  const [data,setData]=useState<Result|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");
  const [state,setState]=useState("All");
  const [filter,setFilter]=useState("All");
  async function refresh(){
    setLoading(true);setError("");
    try {
      const response=await fetch("/api/energy/tenders",{cache:"no-store"});
      const json=await response.json() as Result;
      setData(json);
      if(!response.ok)setError("None of the four source pages returned parseable tender records. Check sources and retry.");
    }catch(err){setData(null);setError(err instanceof Error?err.message:"Public procurement check failed.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void refresh();},[]);
  const shown=useMemo(()=>(data?.tenders??[]).filter(row=>{
    const matchState=state==="All"||row.state===state;
    const matchFilter=filter==="All"||row.reasons.some(reason=>reason.toLowerCase().includes(filter.toLowerCase()));
    const matchText=!query.trim()||[row.title,row.issuer,row.summary??"",row.reasons.join(" ")].join(" ").toLowerCase().includes(query.trim().toLowerCase());
    return matchState&&matchFilter&&matchText;
  }),[data,state,filter,query]);
  function exportEvidence(){
    const value={createdAt:new Date().toISOString(),sourceChecks:data?.checks??[],filteredTenders:shown,warning:"Keyword relevance, not procurement eligibility. Check each official tender listing for document updates, deadlines and conditions."};
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download="solar-intelligence-tender-evidence.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <main className="min-h-screen bg-[#090e17] text-slate-100"><div className="mx-auto max-w-6xl px-4 py-7 sm:px-7">
    <div className="border-b border-white/10 pb-6"><Link to="/energy" className="inline-flex min-h-11 items-center gap-2 text-sm text-cyan-300"><ArrowLeft size={16}/> Energy Market Lab</Link>
      <div className="mt-2 font-mono text-xs uppercase tracking-[.17em] text-cyan-300">Government procurement · Source intelligence</div>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Energy Tender Radar</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Public tender discovery adapted from SPA's proven parsing methods. Checks selected Australian government procurement listings, identifies energy-related descriptions, flags closing dates and links the original source. No SPA private data is accessed.</p>
      <div className="mt-5 flex flex-wrap gap-2"><button type="button" disabled={loading} onClick={()=>void refresh()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-400 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">{loading?<Loader2 size={16} className="animate-spin"/>:<RefreshCw size={16}/>} Refresh official listings</button>
        <button type="button" onClick={exportEvidence} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/20 px-4 text-sm"><Download size={16}/> Export evidence</button>
        <Link to="/decision-room" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/20 px-4 text-sm">CEO Decision Room →</Link>
      </div>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-white/10 bg-[#111d2a] p-4"><div className="text-xs text-slate-400">Screened opportunities</div><div className="mt-2 text-3xl font-semibold">{data?.tenders.length??(loading?"…":0)}</div></div>
      <div className="rounded-lg border border-white/10 bg-[#111d2a] p-4"><div className="text-xs text-slate-400">Sources returning records</div><div className="mt-2 text-3xl font-semibold">{data?.checks.filter(c=>c.status==="parsed").length??(loading?"…":0)} / 4</div></div>
      <div className="rounded-lg border border-white/10 bg-[#111d2a] p-4"><div className="text-xs text-slate-400">Evidence checked</div><div className="mt-2 text-sm font-semibold">{data?.checkedAt?new Date(data.checkedAt).toLocaleString("en-AU",{timeZone:"Australia/Sydney"}):"Pending"}</div></div>
    </div>
    {error&&<div role="alert" className="mt-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"><CircleAlert size={18} className="shrink-0"/>{error}</div>}
    <section className="mt-5 rounded-xl border border-white/10 bg-[#111d2a] p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-300">Keyword<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="solar, battery, microgrid..." className="mt-1 block min-h-12 w-full rounded-lg border border-white/20 bg-[#172536] px-3 text-base text-white"/></label>
        <label className="text-xs text-slate-300">State<select value={state} onChange={e=>setState(e.target.value)} className="mt-1 block min-h-12 w-full rounded-lg border border-white/20 bg-[#172536] px-3 text-base text-white">{["All","NSW","VIC","ACT","TAS"].map(s=><option key={s}>{s}</option>)}</select></label>
        <label className="text-xs text-slate-300">Energy category<select value={filter} onChange={e=>setFilter(e.target.value)} className="mt-1 block min-h-12 w-full rounded-lg border border-white/20 bg-[#172536] px-3 text-base text-white">{["All","Solar","Battery","Remote","EV","Renewable","Electrical","Energy"].map(s=><option key={s}>{s}</option>)}</select></label>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-semibold"><Search size={18} className="text-cyan-300"/> Matching public listings</h2><span className="text-xs text-slate-400">{shown.length} shown</span></div>
      <div className="mt-3 space-y-3">
        {shown.map(t=><article key={t.id} className="rounded-lg border border-white/10 bg-[#172536] p-4">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-cyan-500/15 px-2 py-1 text-xs text-cyan-200">{t.state??"AU"}</span><span className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300">Screening relevance {t.relevanceScore}/100</span><span className="text-xs text-slate-400">{t.closeBand.replace("_"," ")} · {fmtDate(t.closingDate)}</span></div>
          <h3 className="mt-3 text-base font-semibold">{t.title}</h3><p className="mt-1 text-sm text-slate-300">{t.issuer} · {t.sourceName}</p>
          {t.summary&&<p className="mt-3 text-sm leading-6 text-slate-400">{t.summary.slice(0,450)}</p>}
          <div className="mt-3 flex flex-wrap gap-2">{t.reasons.map(reason=><span key={reason} className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-slate-300">{reason}</span>)}</div>
          <div className="mt-3 text-xs text-slate-400">Tender reference: {t.reference??"Not published"}. Check eligibility, open status and precise closure on the original listing.</div>
          <a className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-cyan-300 underline" href={t.sourceUrl} target="_blank" rel="noreferrer">Official procurement source <ArrowUpRight size={15}/></a>
        </article>)}
        {!shown.length&&!loading&&<div className="rounded-lg border border-dashed border-white/20 p-8 text-center text-sm text-slate-400">No qualifying public tenders returned. Missing or blocked sources are reported below; no synthetic tenders are shown.</div>}
        {loading&&<div className="flex min-h-28 items-center justify-center gap-2 text-sm text-slate-300"><Loader2 className="animate-spin" size={18}/> Reading Australian procurement sources…</div>}
      </div>
    </section>
    <section className="mt-5 rounded-xl border border-white/10 bg-[#111d2a] p-5"><h2 className="flex items-center gap-2 text-lg font-semibold"><BadgeCheck size={18} className="text-cyan-300"/> Public source audit</h2>
      <p className="mt-2 text-xs leading-5 text-slate-400">Official portals can block bots or change HTML. A successful HTTP response is not proof a tender remains open. Source failures are not concealed.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{(data?.checks??[]).map(c=><div key={c.sourceId} className="rounded-lg border border-white/10 bg-[#172536] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{c.sourceName}</strong><span className={c.status==="parsed"?"text-xs text-emerald-300":"text-xs text-amber-300"}>{c.status.replace("_"," ")} · {c.retrieved} parsed</span></div>
        {c.error&&<p className="mt-2 text-xs text-slate-400">{c.error}</p>}<a className="mt-2 inline-flex min-h-11 items-center gap-2 text-xs text-cyan-300 underline" href={c.sourceUrl} target="_blank" rel="noreferrer">Source listing <ArrowUpRight size={13}/></a></div>)}</div>
    </section>
    <footer className="py-7 text-xs text-slate-500">Energy Market Lab by Revealing Mind AI · Australian public procurement screening · No SPA account or customer data · No inferred bid-win probabilities</footer>
  </div></main>;
}
