import { useState } from "react";
import { Check, ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";
import { renderDb } from "@/integrations/render/client";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import type { NamedBusinessResearch } from "@/lib/prospect/named-research.functions";

export function NameResearchPanel({ result }: { result: NamedBusinessResearch }) {
  const ws = useWorkspace();
  const [saved, setSaved] = useState<string[]>([]);
  const [saving, setSaving] = useState<string[]>([]);

  async function saveCompany(companyName: string, sourceUrl: string | null) {
    const key = companyName.toLowerCase();
    if (saving.includes(key) || saved.includes(key)) return;
    setSaving((prev) => [...prev, key]);
    try {
      const { data: existing, error: lookupError } = await renderDb
        .from("companies").select("id,name").eq("organization_id", ws.organizationId);
      if (lookupError) throw new Error(lookupError.message);
      const found = (existing ?? []).find((c: { name: string }) => c.name.trim().toLowerCase() === key);
      if (!found) {
        const notes = [
          "Added from business-name research.",
          result.location ? "Search area: " + result.location : "",
          sourceUrl ? "Public research source: " + sourceUrl : "Website not verified. Check business identity.",
        ].filter(Boolean).join("\n");
        const { error } = await renderDb.from("companies").insert({
          organization_id: ws.organizationId,
          name: companyName,
          website: null,
          industry: result.industry || null,
          country: null,
          employee_range: null,
          status: "researching",
          notes,
        });
        if (error) throw new Error(error.message);
      }
      setSaved((prev) => [...prev, key]);
      toast.success(found ? "Company is already in your CRM" : companyName + " saved to CRM");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save this company");
    } finally {
      setSaving((prev) => prev.filter((value) => value !== key));
    }
  }

  const savedButton = (companyName: string, sourceUrl: string | null) => {
    const key = companyName.toLowerCase();
    const isSaved = saved.includes(key);
    return (
      <Button type="button" size="sm" variant="outline" disabled={isSaved || saving.includes(key)} onClick={() => void saveCompany(companyName, sourceUrl)}>
        {isSaved ? <Check className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
        {isSaved ? "In CRM" : "Save to CRM"}
      </Button>
    );
  };

  return (
    <section className="mt-6 space-y-5" aria-label="Business name research results">
      <div className="rounded-lg border bg-card p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Business research · website not required</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">{result.business_name}</h2>
            <p className="text-sm text-muted-foreground">{[result.location, result.industry].filter(Boolean).join(" · ") || "Location and industry not yet verified"}</p>
          </div>
          {savedButton(result.business_name, result.sources[0]?.url ?? null)}
        </div>
        {result.overview && <p className="mt-3 text-sm">{result.overview}</p>}
        <p className="mt-3 text-xs text-muted-foreground">{result.notice}</p>
        <p className="mt-2 text-xs text-muted-foreground">No website was required or invented. If no official website is confirmed, the CRM record will have an empty website field.</p>
        <div className="mt-4">
          <h3 className="mb-2 font-medium">Public references ({result.sources.length})</h3>
          {result.sources.length ? (
            <ul className="space-y-3">
              {result.sources.map((source) => (
                <li key={source.url} className="rounded-md border p-3">
                  <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 break-all text-sm font-medium text-primary hover:underline">
                    {source.title} <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  {source.snippet && <p className="mt-1 text-xs text-muted-foreground">{source.snippet}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No matching listing was retrieved. You can still save this business and investigate it manually.</p>
          )}
          <a href={result.search_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline">
            Check search results manually <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-5">
        <h3 className="text-lg font-semibold">Possible competitors ({result.competitors.length})</h3>
        <p className="mt-1 text-xs text-muted-foreground">Businesses found in public search results. Competition and location still need manual confirmation. No website is assumed from a directory listing.</p>
        {result.competitors.length ? (
          <ul className="mt-3 space-y-3">
            {result.competitors.map((competitor) => (
              <li key={competitor.name.toLowerCase()} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{competitor.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{competitor.relationship}</div>
                    <a href={competitor.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 break-all text-xs text-primary hover:underline">
                      View evidence source <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {savedButton(competitor.name, competitor.source_url)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No competitors could be supported by the retrieved public listings. Try specifying the industry and suburb or town.</p>
        )}
      </div>
    </section>
  );
}
