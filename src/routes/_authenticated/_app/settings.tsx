import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  connectOpenRouter,
  disconnectOpenRouterKey,
  getOpenRouterModels,
  getSpaAiSettings,
  setOpenRouterModel,
} from "@/lib/spa/openrouter.functions";

export const Route = createFileRoute("/_authenticated/_app/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "AI & Models — SPA Intelligence" },
      { name: "description", content: "Connect Brett's OpenRouter account and choose the models used by SPA Intelligence." },
    ],
  }),
});

type Filter = "all" | "free" | "low" | "large" | "tools" | "structured" | "vision";

function perMillion(raw: string | null) {
  if (raw == null) return "not supplied";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n === 0 ? "free" : `$${(n * 1_000_000).toFixed(n * 1_000_000 < 0.01 ? 4 : 2)}/M`;
}

function SettingsPage() {
  const getSettings = useServerFn(getSpaAiSettings);
  const getModels = useServerFn(getOpenRouterModels);
  const connect = useServerFn(connectOpenRouter);
  const disconnect = useServerFn(disconnectOpenRouterKey);
  const setModel = useServerFn(setOpenRouterModel);

  const [settings, setSettings] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setCatalogBusy(true);
    try {
      const [s, m] = await Promise.all([getSettings(), getModels()]);
      setSettings(s);
      setModels(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCatalogBusy(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function saveKey(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setMessage(null);
    try {
      const r = await connect({ data: { apiKey } });
      setApiKey("");
      setMessage("OpenRouter connection verified. The key has been encrypted and stored server-side.");
      setSettings((s: any) => ({ ...(s ?? {}), ...r }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  async function removeKey() {
    setBusy(true); setError(null); setMessage(null);
    try {
      await disconnect();
      setSettings((s: any) => ({ ...(s ?? {}), connected: false, keyEnding: null }));
      setMessage("Workspace OpenRouter key disconnected.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  async function chooseModel(model: string) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const r = await setModel({ data: { model } });
      setSettings((s: any) => ({ ...(s ?? {}), model: r.model }));
      setMessage(`Default model set to ${model}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  const visible = useMemo(() => models.filter((m) => {
    const hay = `${m.name} ${m.id} ${m.provider} ${m.description}`.toLowerCase();
    if (query && !hay.includes(query.toLowerCase())) return false;
    const prompt = Number(m.promptPrice);
    const completion = Number(m.completionPrice);
    if (filter === "free") return prompt === 0 && completion === 0;
    if (filter === "low") return Number.isFinite(prompt) && Number.isFinite(completion) && (prompt + completion) * 1_000_000 <= 1;
    if (filter === "large") return (m.contextLength ?? 0) >= 200_000;
    if (filter === "tools") return m.supportedParameters?.some((p: string) => /tool/i.test(p));
    if (filter === "structured") return m.supportedParameters?.some((p: string) => /structured|response_format/i.test(p));
    if (filter === "vision") return m.inputModalities?.some((x: string) => /image/i.test(x));
    return true;
  }).slice(0, 150), [models, query, filter]);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 border-b border-border pb-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Settings / AI & Models</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Brett controls the AI provider</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          OpenRouter remains the billing layer. SPA Intelligence stores only an encrypted API key and the model choice required to run approved research.
        </p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[430px_1fr]">
        <div className="space-y-5">
          <section className="border border-border bg-card p-5">
            <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /><h2 className="font-semibold">Connect OpenRouter</h2></div>
            <ol className="mt-4 space-y-3 text-sm">
              <li><span className="mr-2 font-mono text-xs text-primary">01</span><a href="https://openrouter.ai/" target="_blank" rel="noreferrer" className="hover:underline">Open OpenRouter <ExternalLink className="inline h-3 w-3" /></a></li>
              <li><span className="mr-2 font-mono text-xs text-primary">02</span>Add credits to your OpenRouter account if required.</li>
              <li><span className="mr-2 font-mono text-xs text-primary">03</span><a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="hover:underline">Create an API key <ExternalLink className="inline h-3 w-3" /></a></li>
              <li><span className="mr-2 font-mono text-xs text-primary">04</span>Paste it below and test the connection.</li>
              <li><span className="mr-2 font-mono text-xs text-primary">05</span>Choose the live model used for new research.</li>
            </ol>

            <div className="mt-5 border-t border-border pt-4">
              {settings?.connected ? (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-emerald-400" />Connected</div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">Key ending ••••{settings.keyEnding}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={removeKey} disabled={busy}><Trash2 className="mr-1 h-3.5 w-3.5" />Disconnect</Button>
                </div>
              ) : (
                <form onSubmit={saveKey} className="space-y-3">
                  <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-or-v1-…" autoComplete="off" />
                  <Button type="submit" disabled={busy || apiKey.trim().length < 20} className="w-full">{busy ? "Testing…" : "Test & connect key"}</Button>
                  <p className="text-[11px] leading-5 text-muted-foreground">The full key is submitted over HTTPS to the server, validated against OpenRouter, encrypted at rest, and is not returned to the browser after saving.</p>
                </form>
              )}
            </div>
          </section>

          <section className="border border-border bg-card p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Global default model</div>
            <div className="mt-2 break-all text-sm font-semibold">{settings?.model || "Loading…"}</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">The model actually returned by OpenRouter is recorded on each live dossier. SPA Intelligence does not silently substitute a different configured model.</p>
          </section>

          {message && <div className="border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">{message}</div>}
          {error && <div className="border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        </div>

        <section className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Live OpenRouter model catalogue</h2>
                <p className="mt-1 text-xs text-muted-foreground">{catalogBusy ? "Loading current catalogue…" : `${models.length} models returned by OpenRouter`}</p>
              </div>
              <Button variant="outline" size="sm" onClick={refresh} disabled={catalogBusy}>Refresh catalogue</Button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search model, provider or ID" className="pl-9" /></div>
              <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="h-10 border border-input bg-background px-3 text-sm">
                <option value="all">All</option>
                <option value="free">Free</option>
                <option value="low">Low cost</option>
                <option value="large">Large context</option>
                <option value="tools">Tool capable</option>
                <option value="structured">Structured output</option>
                <option value="vision">Vision capable</option>
              </select>
            </div>
          </div>

          <div className="max-h-[72vh] overflow-auto divide-y divide-border">
            {visible.map((m) => {
              const selected = settings?.model === m.id;
              return (
                <button key={m.id} onClick={() => chooseModel(m.id)} disabled={busy} className={`w-full p-4 text-left transition-colors hover:bg-muted/50 ${selected ? "bg-primary/5" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{m.name}</strong>{selected && <span className="border border-primary/40 px-1.5 py-0.5 font-mono text-[9px] uppercase text-primary">selected</span>}</div>
                      <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{m.id}</div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                      <div>IN {perMillion(m.promptPrice)}</div><div>OUT {perMillion(m.completionPrice)}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
                    <span>Provider: {m.provider}</span>
                    <span>Context: {m.contextLength ? m.contextLength.toLocaleString() : "not supplied"}</span>
                    <span>Input: {m.inputModalities?.join(", ") || "not supplied"}</span>
                    <span>Output: {m.outputModalities?.join(", ") || "not supplied"}</span>
                  </div>
                  {!!m.supportedParameters?.length && <div className="mt-2 line-clamp-1 font-mono text-[9px] text-muted-foreground">Params: {m.supportedParameters.join(", ")}</div>}
                </button>
              );
            })}
            {!catalogBusy && visible.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No current models match those filters.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
