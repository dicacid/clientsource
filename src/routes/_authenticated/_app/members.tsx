import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Check, RotateCcw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getApprovalItems, setApprovalState } from "@/lib/spa/store.functions";

export const Route = createFileRoute("/_authenticated/_app/members")({
  head: () => ({ meta: [{ title: "Approval Queue — SPA Intelligence" }] }),
  component: ApprovalQueue,
});

const STATES = [
  "DETECTED","RESEARCHED","QUALIFIED","PREPARED","AWAITING APPROVAL","NEEDS CHANGES",
  "APPROVED","ACTIONED","FOLLOW-UP DUE","WON","LOST","NO BID","ARCHIVED",
] as const;

function ApprovalQueue() {
  const getItems = useServerFn(getApprovalItems);
  const setState = useServerFn(setApprovalState);
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try { setItems(await getItems()); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  useEffect(() => { void refresh(); }, []);

  async function change(id: string, state: typeof STATES[number]) {
    setBusy(id); setError(null);
    try {
      await setState({ data: { id, state } });
      setItems((rows) => rows.map((x) => x.id === id ? { ...x, state, updatedAt: new Date().toISOString() } : x));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-7 border-b border-border pb-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Human control layer</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Approval Queue</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">AI prepares the repetitive work. Brett makes consequential decisions here. Nothing in this queue sends email or submits a tender automatically.</p>
      </header>

      {error && <div className="mb-4 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {!items.length ? (
        <div className="grid min-h-56 place-items-center border border-dashed border-border p-8 text-center">
          <div><ShieldCheck className="mx-auto h-7 w-7 text-muted-foreground" /><h2 className="mt-3 font-semibold">Nothing awaiting approval</h2><p className="mt-2 text-sm text-muted-foreground">Research a prospect and choose “Create approval item”.</p></div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const dossier = item.payload?.dossier;
            return <article key={item.id} className="border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-primary">{item.kind}</div>
                  <h2 className="mt-1 text-lg font-semibold">{item.title}</h2>
                  {dossier?.next_action && <p className="mt-2 text-sm text-muted-foreground"><strong className="text-foreground">Proposed next action:</strong> {dossier.next_action}</p>}
                  {dossier?.possible_first_approach && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{dossier.possible_first_approach}</p>}
                  <div className="mt-3 font-mono text-[10px] text-muted-foreground">Created {new Date(item.createdAt).toLocaleString()} · Updated {new Date(item.updatedAt).toLocaleString()}</div>
                </div>
                <div className="min-w-52">
                  <label className="font-mono text-[10px] uppercase text-muted-foreground">Workflow state</label>
                  <select value={item.state} disabled={busy === item.id} onChange={(e) => change(item.id, e.target.value as typeof STATES[number])} className="mt-1 h-10 w-full border border-input bg-background px-2 text-sm">
                    {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button size="sm" onClick={() => change(item.id, "APPROVED")} disabled={busy === item.id}><Check className="mr-1 h-3.5 w-3.5" />Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => change(item.id, "NEEDS CHANGES")} disabled={busy === item.id}><RotateCcw className="mr-1 h-3.5 w-3.5" />Changes</Button>
                    <Button size="sm" variant="outline" onClick={() => change(item.id, "NO BID")} disabled={busy === item.id}><X className="mr-1 h-3.5 w-3.5" />No bid</Button>
                    <Button size="sm" variant="outline" onClick={() => change(item.id, "ARCHIVED")} disabled={busy === item.id}>Archive</Button>
                  </div>
                </div>
              </div>
            </article>;
          })}
        </div>
      )}
    </div>
  );
}
