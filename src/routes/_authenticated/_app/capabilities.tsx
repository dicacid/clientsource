import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { capabilityText } from "@/lib/spa/capabilities";
import { getSpaCapabilityProfile, setSpaCapabilityProfile } from "@/lib/spa/store.functions";

export const Route = createFileRoute("/_authenticated/_app/capabilities")({
  head: () => ({ meta: [{ title: "SPA Capability Profile — SPA Intelligence" }] }),
  component: CapabilityProfile,
});

function CapabilityProfile() {
  const getProfile = useServerFn(getSpaCapabilityProfile);
  const saveProfile = useServerFn(setSpaCapabilityProfile);
  const [profile, setProfile] = useState(capabilityText());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getProfile()
      .then((stored) => { if (stored) setProfile(stored); })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(null);
    try {
      const result = await saveProfile({ data: { profile } });
      setProfile(result.profile);
      setSaved("Capability profile saved to the SPA Intelligence workspace.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-7 border-b border-border pb-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Grounding layer</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">SPA Capability Profile</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          This is the commercial grounding passed into SPA research. Keep the provenance marker on every capability so the AI does not turn adjacent or unverified capability into fact.
        </p>
      </header>

      <form onSubmit={save} className="border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-primary" />Persistent workspace profile</div>
          <div className="font-mono text-[10px] uppercase text-muted-foreground">CONFIRMED · LIKELY / ADJACENT · NEEDS VERIFICATION</div>
        </div>
        <div className="p-4">
          <Textarea value={profile} onChange={(e) => setProfile(e.target.value)} className="min-h-[56vh] font-mono text-xs leading-5" />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-xs leading-5 text-muted-foreground">Edit only what SPA can genuinely support. A useful unknown is preferable to claiming capability that has not been confirmed by Brett or a reliable public source.</p>
            <Button type="submit" disabled={busy || !profile.trim()}><Save className="mr-2 h-4 w-4" />{busy ? "Saving…" : "Save capability profile"}</Button>
          </div>
        </div>
      </form>

      {saved && <div className="mt-4 border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">{saved}</div>}
      {error && <div className="mt-4 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    </div>
  );
}
