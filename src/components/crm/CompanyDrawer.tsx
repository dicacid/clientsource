import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { renderDb } from "@/integrations/render/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTIVITY_TYPES, COMPANY_STATUSES, label } from "@/lib/constants";
import { friendlyError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";
import { OptionSelect, StatusBadge } from "./shared";
import { ContactForm } from "./ContactForm";

const NO_CONTACT = "__none__";

export function CompanyDrawer({ companyId, onClose }: { companyId: string | null; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [type, setType] = useState<string>("note");
  const [contactId, setContactId] = useState<string>(NO_CONTACT);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [addContact, setAddContact] = useState(false);

  const q = useQuery({
    queryKey: ["company-detail", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [c, contacts, acts] = await Promise.all([
        renderDb.from("companies").select("*").eq("id", companyId!).single(),
        renderDb.from("contacts").select("id, full_name, job_title, email, status").eq("company_id", companyId!).order("full_name"),
        renderDb
          .from("activities")
          .select("id, type, body, created_at, created_by, contact_id")
          .eq("company_id", companyId!)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (c.error) throw c.error;
      if (contacts.error) throw contacts.error;
      if (acts.error) throw acts.error;
      const authorIds = [...new Set(acts.data.map((a: any) => a.created_by))];
      const names: Record<string, string> = {};
      if (authorIds.length) {
        const { data: profs } = await renderDb.from("profiles").select("id, full_name").in("id", authorIds);
        for (const p of profs ?? []) names[p.id] = p.full_name || "Unnamed member";
      }
      return { company: c.data, contacts: contacts.data, activities: acts.data, names };
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["company-detail", companyId] });
    qc.invalidateQueries({ queryKey: ["companies"] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  async function changeStatus(status: string) {
    const { error } = await renderDb.from("companies").update({ status }).eq("id", companyId!);
    if (error) return toast.error(friendlyError(error));
    toast.success("Status updated");
    refresh();
  }

  async function logActivity(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return toast.error("Write something first.");
    setBusy(true);
    const { error } = await renderDb.from("activities").insert({
      organization_id: ws.organizationId,
      company_id: companyId!,
      contact_id: contactId === NO_CONTACT ? null : contactId,
      type,
      body: body.trim(),
      created_by: ws.userId,
    });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    setBody("");
    toast.success("Activity logged");
    refresh();
  }

  const d = q.data;
  const contactName = (id: string | null) => d?.contacts.find((c: any) => c.id === id)?.full_name;

  return (
    <Sheet open={!!companyId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {!d ? (
          <div className="space-y-3 pt-6">
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="text-xl">{d.company.name}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Info k="Website" v={d.company.website} />
              <Info k="Industry" v={d.company.industry} />
              <Info k="Country" v={d.company.country} />
              <Info k="Employees" v={d.company.employee_range} />
              <div className="col-span-2">
                <div className="mb-1 text-xs text-muted-foreground">Status</div>
                <OptionSelect value={d.company.status} onChange={changeStatus} options={COMPANY_STATUSES} ariaLabel="Company status" className="w-48" />
              </div>
              {d.company.notes && <p className="col-span-2 whitespace-pre-wrap text-muted-foreground">{d.company.notes}</p>}
            </div>

            <section className="mt-8">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Contacts ({d.contacts.length})</h3>
                <Button size="sm" variant="outline" onClick={() => setAddContact(true)}>
                  Add contact
                </Button>
              </div>
              {d.contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No contacts yet.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {d.contacts.map((c: any) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{c.full_name}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.job_title ?? "—"} {c.email ? `· ${c.email}` : ""}</div>
                      </div>
                      <StatusBadge status={c.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-8">
              <h3 className="mb-2 text-sm font-semibold">Log activity</h3>
              <form onSubmit={logActivity} className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <OptionSelect value={type} onChange={setType} options={ACTIVITY_TYPES} ariaLabel="Activity type" className="w-36" />
                  <Select value={contactId} onValueChange={setContactId}>
                    <SelectTrigger className="w-52" aria-label="Contact">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CONTACT}>No specific contact</SelectItem>
                      {d.contacts.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened?" rows={3} />
                <Button type="submit" size="sm" disabled={busy}>
                  {busy ? "Saving…" : "Log activity"}
                </Button>
              </form>
            </section>

            <section className="mt-8 pb-8">
              <h3 className="mb-3 text-sm font-semibold">Timeline</h3>
              {d.activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ol className="space-y-4 border-l pl-4">
                  {d.activities.map((a: any) => (
                    <li key={a.id} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono uppercase text-primary">{label(a.type)}</span>
                        <span>{d.names[a.created_by] ?? "Former member"}</span>
                        {a.contact_id && <span>· with {contactName(a.contact_id)}</span>}
                        <span>· {a.created_at ? new Date(a.created_at).toLocaleString() : ""}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{a.body}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <ContactForm open={addContact} onOpenChange={setAddContact} defaultCompanyId={companyId!} onSaved={refresh} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Info({ k, v }: { k: string; v: string | null }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="truncate">{v || "—"}</div>
    </div>
  );
}
