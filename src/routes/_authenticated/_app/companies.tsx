import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { renderDb } from "@/integrations/render/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COMPANY_STATUSES, EMPLOYEE_RANGES } from "@/lib/constants";
import { friendlyError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";
import { downloadCsv, toCsv } from "@/lib/csv";
import { ConfirmDelete, EmptyState, OptionSelect, PageHeader } from "@/components/crm/shared";
import { CompanyForm, type CompanyRow } from "@/components/crm/CompanyForm";
import { CompanyDrawer } from "@/components/crm/CompanyDrawer";

export const Route = createFileRoute("/_authenticated/_app/companies")({
  head: () => ({
    meta: [
      { title: "Companies — Pipeline" },
      { name: "description", content: "Search, filter and manage target companies." },
      { property: "og:title", content: "Companies — Pipeline" },
      { property: "og:description", content: "Search, filter and manage target companies." },
    ],
  }),
  component: Companies,
});

const PAGE = 25;
type SortKey = "name" | "industry" | "country" | "employee_range" | "status" | "created_at";
const EXPORT_COLS = ["name", "website", "industry", "country", "employee_range", "status", "notes"];

function Companies() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("");
  const [country, setCountry] = useState("");
  const [range, setRange] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "created_at", asc: false });
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<CompanyRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [drawer, setDrawer] = useState<string | null>(null);

  const filters = { search, industry, country, range, status };
  const hasFilters = Object.values(filters).some(Boolean);

  function buildQuery(select: string, withCount: boolean) {
    let q = renderDb
      .from("companies")
      .select(select, withCount ? { count: "exact" } : undefined)
      .eq("organization_id", ws.organizationId);
    if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
    if (industry.trim()) q = q.ilike("industry", `%${industry.trim()}%`);
    if (country.trim()) q = q.ilike("country", `%${country.trim()}%`);
    if (range) q = q.eq("employee_range", range);
    if (status) q = q.eq("status", status);
    return q.order(sort.key, { ascending: sort.asc, nullsFirst: false }).order("id");
  }

  const q = useQuery({
    queryKey: ["companies", ws.organizationId, filters, sort, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error, count } = await buildQuery("*", true).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as unknown as CompanyRow[], count: count ?? 0 };
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["companies"] });
    qc.invalidateQueries({ queryKey: ["company-options"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const upd = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(0);
  };

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }));
    setPage(0);
  }

  async function del(c: CompanyRow) {
    const { error } = await renderDb.from("companies").delete().eq("id", c.id);
    if (error) return toast.error(friendlyError(error));
    toast.success("Company deleted");
    refresh();
  }

  async function exportCsv() {
    const { data, error } = await buildQuery(EXPORT_COLS.join(","), false).limit(10000);
    if (error) return toast.error(friendlyError(error));
    downloadCsv(`companies-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_COLS, data as unknown as Record<string, unknown>[]));
    toast.success(`Exported ${data.length} companies`);
  }

  async function inlineStatus(id: string, s: string) {
    const { error } = await renderDb.from("companies").update({ status: s }).eq("id", id);
    if (error) return toast.error(friendlyError(error));
    toast.success("Status updated");
    refresh();
  }

  const total = q.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const SortHead = ({ k, children }: { k: SortKey; children: string }) => (
    <TableHead>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>
        {children}
        {sort.key === k && (sort.asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TableHead>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Companies"
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
              Add company
            </Button>
          </>
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Input placeholder="Search name…" value={search} onChange={(e) => upd(setSearch)(e.target.value)} className="lg:col-span-2" aria-label="Search by name" />
        <Input placeholder="Industry" value={industry} onChange={(e) => upd(setIndustry)(e.target.value)} aria-label="Industry" />
        <Input placeholder="Country" value={country} onChange={(e) => upd(setCountry)(e.target.value)} aria-label="Country" />
        <OptionSelect value={range} onChange={upd(setRange)} options={EMPLOYEE_RANGES} placeholder="Any size" allowAny />
        <OptionSelect value={status} onChange={upd(setStatus)} options={COMPANY_STATUSES} placeholder="Any status" allowAny />
      </div>
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="mb-3"
          onClick={() => {
            setSearch("");
            setIndustry("");
            setCountry("");
            setRange("");
            setStatus("");
            setPage(0);
          }}
        >
          Clear filters
        </Button>
      )}

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
          <EmptyState title="No companies match these filters." />
        ) : (
          <EmptyState title="No companies yet." action={<Button onClick={() => setFormOpen(true)}>Add company</Button>} />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead k="name">Name</SortHead>
                  <SortHead k="industry">Industry</SortHead>
                  <SortHead k="country">Country</SortHead>
                  <SortHead k="employee_range">Size</SortHead>
                  <SortHead k="status">Status</SortHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data!.rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <button className="text-left font-medium hover:text-primary focus-visible:outline-none focus-visible:underline" onClick={() => setDrawer(c.id)}>
                        {c.name}
                      </button>
                      {c.website && <div className="font-mono text-xs text-muted-foreground">{c.website.replace("https://", "")}</div>}
                    </TableCell>
                    <TableCell>{c.industry ?? "—"}</TableCell>
                    <TableCell>{c.country ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{c.employee_range ?? "—"}</TableCell>
                    <TableCell>
                      <OptionSelect value={c.status} onChange={(v) => inlineStatus(c.id, v)} options={COMPANY_STATUSES} className="h-8 w-36" ariaLabel={`Status of ${c.name}`} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Edit ${c.name}`}
                          onClick={() => {
                            setEditing(c);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <ConfirmDelete
                          title={`Delete ${c.name}?`}
                          description="This also deletes its activity log. Companies with contacts can't be deleted."
                          onConfirm={() => del(c)}
                          trigger={
                            <Button size="icon" variant="ghost" aria-label={`Delete ${c.name}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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
      <CompanyForm open={formOpen} onOpenChange={setFormOpen} company={editing} onSaved={refresh} />
      <CompanyDrawer companyId={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
