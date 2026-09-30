import { createFileRoute } from "@tanstack/react-router";
import { useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { renderDb } from "@/integrations/render/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COMPANY_STATUSES, CONTACT_STATUSES, EMAIL_RE, EMPLOYEE_RANGES } from "@/lib/constants";
import { BATCH_SIZE, IMPORT_ROW_CAP, parseCsv } from "@/lib/csv";
import { normalizeWebsiteResult } from "@/lib/website";
import { friendlyError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/crm/shared";

export const Route = createFileRoute("/_authenticated/_app/import")({
  head: () => ({
    meta: [
      { title: "Import CSV — Pipeline" },
      { name: "description", content: "Import companies and contacts from CSV." },
      { property: "og:title", content: "Import CSV — Pipeline" },
      { property: "og:description", content: "Import companies and contacts from CSV." },
    ],
  }),
  component: ImportPage,
});

type Kind = "companies" | "contacts";
type Valid = { line: number; record: Record<string, unknown>; label: string };
type Invalid = { line: number; label: string; error: string };

const COLS: Record<Kind, string[]> = {
  companies: ["name", "website", "industry", "country", "employee_range", "status", "notes"],
  contacts: ["full_name", "job_title", "email", "phone", "company_name", "company_website", "status", "next_follow_up", "notes"],
};

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function ImportPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("companies");
  const [valid, setValid] = useState<Valid[]>([]);
  const [invalid, setInvalid] = useState<Invalid[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function reset() {
    setValid([]);
    setInvalid([]);
    setFileName("");
    setDone(null);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    reset();
    setFileName(file.name);
    const { rows, error } = parseCsv(await file.text());
    if (error) return toast.error(`Couldn't read CSV: ${error}`);
    if (rows.length > IMPORT_ROW_CAP) return toast.error(`File has ${rows.length} rows. The limit is ${IMPORT_ROW_CAP}.`);
    if (rows.length === 0) return toast.error("The file has no data rows.");
    setBusy(true);
    try {
      if (kind === "companies") await prepareCompanies(rows);
      else await prepareContacts(rows);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function prepareCompanies(rows: Record<string, string>[]) {
    const { data: existing, error } = await renderDb
      .from("companies")
      .select("website")
      .eq("organization_id", ws.organizationId)
      .not("website", "is", null)
      .limit(10000);
    if (error) throw error;
    const seen = new Set(existing.map((c) => c.website));
    const ok: Valid[] = [];
    const bad: Invalid[] = [];
    rows.forEach((r, i) => {
      const line = i + 2;
      const name = s(r.name);
      const lbl = name || "(no name)";
      if (!name) return bad.push({ line, label: lbl, error: "Missing name" });
      const w = normalizeWebsiteResult(r.website);
      if (!w.ok) return bad.push({ line, label: lbl, error: `Invalid website "${r.website}"` });
      const range = s(r.employee_range);
      if (range && !(EMPLOYEE_RANGES as readonly string[]).includes(range))
        return bad.push({ line, label: lbl, error: `Invalid employee_range "${range}"` });
      const status = s(r.status).toLowerCase() || "new";
      if (!(COMPANY_STATUSES as readonly string[]).includes(status)) return bad.push({ line, label: lbl, error: `Invalid status "${r.status}"` });
      if (w.value && seen.has(w.value)) return bad.push({ line, label: lbl, error: `A company with ${w.value} already exists` });
      if (w.value) seen.add(w.value);
      // Only whitelisted columns are read; organization_id always comes from the session.
      ok.push({
        line,
        label: lbl,
        record: {
          organization_id: ws.organizationId,
          name,
          website: w.value,
          industry: s(r.industry) || null,
          country: s(r.country) || null,
          employee_range: range || null,
          status,
          notes: s(r.notes) || null,
        },
      });
    });
    setValid(ok);
    setInvalid(bad);
  }

  async function prepareContacts(rows: Record<string, string>[]) {
    const { data: companies, error } = await renderDb
      .from("companies")
      .select("id, name, website")
      .eq("organization_id", ws.organizationId)
      .limit(10000);
    if (error) throw error;
    const byWebsite = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const c of companies) {
      if (c.website) byWebsite.set(c.website, c.id);
      const k = c.name.trim().toLowerCase();
      if (!byName.has(k)) byName.set(k, c.id);
    }
    const ok: Valid[] = [];
    const bad: Invalid[] = [];
    rows.forEach((r, i) => {
      const line = i + 2;
      const name = s(r.full_name);
      const lbl = name || "(no name)";
      if (!name) return bad.push({ line, label: lbl, error: "Missing full_name" });
      const email = s(r.email);
      if (email && !EMAIL_RE.test(email)) return bad.push({ line, label: lbl, error: `Invalid email "${email}"` });
      const status = s(r.status).toLowerCase() || "new";
      if (!(CONTACT_STATUSES as readonly string[]).includes(status)) return bad.push({ line, label: lbl, error: `Invalid status "${r.status}"` });
      const fu = s(r.next_follow_up);
      if (fu && (!/^\d{4}-\d{2}-\d{2}$/.test(fu) || isNaN(Date.parse(fu))))
        return bad.push({ line, label: lbl, error: `next_follow_up must be YYYY-MM-DD` });
      let companyId: string | undefined;
      const w = normalizeWebsiteResult(r.company_website);
      if (w.ok && w.value) companyId = byWebsite.get(w.value);
      if (!companyId && s(r.company_name)) companyId = byName.get(s(r.company_name).toLowerCase());
      if (!companyId) return bad.push({ line, label: lbl, error: "No matching company in this workspace" });
      ok.push({
        line,
        label: lbl,
        record: {
          organization_id: ws.organizationId,
          company_id: companyId,
          full_name: name,
          job_title: s(r.job_title) || null,
          email: email || null,
          phone: s(r.phone) || null,
          status,
          next_follow_up: fu || null,
          notes: s(r.notes) || null,
        },
      });
    });
    setValid(ok);
    setInvalid(bad);
  }

  async function confirm() {
    setBusy(true);
    let inserted = 0;
    const failed: Invalid[] = [];
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE);
      const { error } = await renderDb.from(kind).insert(batch.map((b) => b.record) as never);
      if (!error) {
        inserted += batch.length;
        continue;
      }
      // Batch failed: retry row by row so one bad row doesn't sink the rest.
      for (const b of batch) {
        const { error: e1 } = await renderDb.from(kind).insert(b.record as never);
        if (e1) failed.push({ line: b.line, label: b.label, error: friendlyError(e1) });
        else inserted++;
      }
    }
    setBusy(false);
    setValid([]);
    setInvalid((prev) => [...prev, ...failed].sort((a, b) => a.line - b.line));
    setDone(`Imported ${inserted} ${kind}.`);
    toast.success(`Imported ${inserted} ${kind}`);
    qc.invalidateQueries();
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Import CSV" sub={`Up to ${IMPORT_ROW_CAP} rows. Parsed in your browser — nothing is uploaded until you confirm.`} />
      <Tabs
        value={kind}
        onValueChange={(v) => {
          setKind(v as Kind);
          reset();
        }}
      >
        <TabsList>
          <TabsTrigger value="companies">Companies</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-4 rounded-lg border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          Columns: <span className="font-mono text-foreground">{COLS[kind].join(", ")}</span>. Other columns (including any id or organization
          columns) are ignored.
          {kind === "contacts" && " Contacts are matched to an existing company by website first, then by exact name. Companies are never created from contact rows."}
        </p>
        <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-within:ring-2 focus-within:ring-ring">
          Choose CSV file
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} disabled={busy} />
        </label>
        {fileName && <span className="ml-3 font-mono text-xs text-muted-foreground">{fileName}</span>}
      </div>

      {done && <p className="mt-4 text-sm text-primary">{done}</p>}

      {valid.length > 0 && (
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Ready to import ({valid.length})</h2>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={confirm} disabled={busy}>
                {busy ? "Importing…" : `Confirm import of ${valid.length}`}
              </Button>
            </div>
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Line</TableHead>
                  {COLS[kind]
                    .filter((c) => c !== "company_name" && c !== "company_website")
                    .map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {valid.slice(0, 100).map((v) => (
                  <TableRow key={v.line}>
                    <TableCell className="font-mono text-xs">{v.line}</TableCell>
                    {COLS[kind]
                      .filter((c) => c !== "company_name" && c !== "company_website")
                      .map((c) => (
                        <TableCell key={c} className="max-w-48 truncate text-xs">
                          {String(v.record[c] ?? "")}
                        </TableCell>
                      ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {valid.length > 100 && <p className="mt-1 text-xs text-muted-foreground">Showing first 100 rows.</p>}
        </section>
      )}

      {invalid.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-destructive">Skipped rows ({invalid.length})</h2>
          <div className="max-h-80 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Line</TableHead>
                  <TableHead>Row</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invalid.map((r) => (
                  <TableRow key={`${r.line}-${r.error}`}>
                    <TableCell className="font-mono text-xs">{r.line}</TableCell>
                    <TableCell>{r.label}</TableCell>
                    <TableCell className="text-destructive">{r.error}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}
