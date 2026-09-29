import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONTACT_STATUSES, localDate } from "@/lib/constants";
import { friendlyError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";
import { downloadCsv, toCsv } from "@/lib/csv";
import { ConfirmDelete, EmptyState, OptionSelect, PageHeader, StatusBadge } from "@/components/crm/shared";
import { ContactForm, type ContactRow } from "@/components/crm/ContactForm";

export const Route = createFileRoute("/_authenticated/_app/contacts")({
  head: () => ({
    meta: [
      { title: "Contacts — Pipeline" },
      { name: "description", content: "People at your target companies and their follow-ups." },
      { property: "og:title", content: "Contacts — Pipeline" },
      { property: "og:description", content: "People at your target companies and their follow-ups." },
    ],
  }),
  component: Contacts,
});

const PAGE = 25;
type Row = ContactRow & { companies: { name: string; website: string | null } | null };

function Contacts() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const today = localDate();
  const hasFilters = !!search || !!status || overdue;

  function buildQuery(withCount: boolean) {
    let q = supabase
      .from("contacts")
      .select("*, companies(name, website)", withCount ? { count: "exact" } : undefined)
      .eq("organization_id", ws.organizationId);
    if (search.trim()) q = q.ilike("full_name", `%${search.trim()}%`);
    if (status) q = q.eq("status", status);
    if (overdue) q = q.lt("next_follow_up", today).not("status", "in", "(customer,lost)");
    return q.order(overdue ? "next_follow_up" : "created_at", { ascending: overdue }).order("id");
  }

  const q = useQuery({
    queryKey: ["contacts", ws.organizationId, search, status, overdue, today, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error, count } = await buildQuery(true).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as unknown as Row[], count: count ?? 0 };
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["company-detail"] });
  };

  async function del(c: ContactRow) {
    const { error } = await supabase.from("contacts").delete().eq("id", c.id);
    if (error) return toast.error(friendlyError(error));
    toast.success("Contact deleted");
    refresh();
  }

  async function copy(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      toast.success("Email copied");
    } catch {
      toast.error("Couldn't access the clipboard");
    }
  }

  async function exportCsv() {
    const { data, error } = await buildQuery(false).limit(10000);
    if (error) return toast.error(friendlyError(error));
    const cols = ["full_name", "job_title", "email", "phone", "company_name", "company_website", "status", "next_follow_up", "notes"];
    const rows = (data as unknown as Row[]).map((r) => ({
      ...r,
      company_name: r.companies?.name ?? "",
      company_website: r.companies?.website ?? "",
    }));
    downloadCsv(`contacts-${today}.csv`, toCsv(cols, rows));
    toast.success(`Exported ${rows.length} contacts`);
  }

  const total = q.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Contacts"
        sub={`${total} matching`}
        actions={
          <>
            <Button variant="outline" onClick={exportCsv}>
              Export CSV
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add contact
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          className="max-w-xs"
          aria-label="Search contacts"
        />
        <OptionSelect
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
          options={CONTACT_STATUSES}
          placeholder="Any status"
          allowAny
          className="w-40"
        />
        <div className="flex items-center gap-2">
          <Switch
            id="overdue"
            checked={overdue}
            onCheckedChange={(v) => {
              setOverdue(v);
              setPage(0);
            }}
          />
          <Label htmlFor="overdue">Overdue follow-ups (before {today})</Label>
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setStatus("");
              setOverdue(false);
              setPage(0);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : q.error ? (
        <p className="text-destructive">{friendlyError(q.error)}</p>
      ) : q.data!.rows.length === 0 ? (
        hasFilters ? (
          <EmptyState title="No contacts match these filters." />
        ) : (
          <EmptyState title="No contacts yet." action={<Button onClick={() => setFormOpen(true)}>Add contact</Button>} />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next follow-up</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data!.rows.map((c) => {
                  const isOverdue = c.next_follow_up && c.next_follow_up < today && !["customer", "lost"].includes(c.status);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.full_name}</div>
                        {c.email && <div className="text-xs text-muted-foreground">{c.email}</div>}
                      </TableCell>
                      <TableCell>{c.companies?.name ?? "—"}</TableCell>
                      <TableCell>{c.job_title ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell className={`font-mono text-xs ${isOverdue ? "text-destructive" : ""}`}>{c.next_follow_up ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {c.email && (
                            <Button size="icon" variant="ghost" aria-label={`Copy email of ${c.full_name}`} onClick={() => copy(c.email!)}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Edit ${c.full_name}`}
                            onClick={() => {
                              setEditing(c);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <ConfirmDelete
                            title={`Delete ${c.full_name}?`}
                            description="Activities that mention this contact are kept, without the contact link."
                            onConfirm={() => del(c)}
                            trigger={
                              <Button size="icon" variant="ghost" aria-label={`Delete ${c.full_name}`}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            }
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {page + 1} of {pages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
      <ContactForm open={formOpen} onOpenChange={setFormOpen} contact={editing} onSaved={refresh} />
    </div>
  );
}
