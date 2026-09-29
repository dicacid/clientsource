import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { COMPANY_STATUSES, EMPLOYEE_RANGES } from "@/lib/constants";
import { normalizeWebsiteResult } from "@/lib/website";
import { friendlyError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";
import { OptionSelect } from "./shared";

export type CompanyRow = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  country: string | null;
  employee_range: string | null;
  status: string;
  notes: string | null;
  created_at: string | null;
};

const empty = { name: "", website: "", industry: "", country: "", employee_range: "", status: "new", notes: "" };

export function CompanyForm({
  open,
  onOpenChange,
  company,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  company?: CompanyRow | null;
  onSaved: () => void;
}) {
  const ws = useWorkspace();
  const [f, setF] = useState(empty);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open)
      setF(
        company
          ? {
              name: company.name,
              website: company.website ?? "",
              industry: company.industry ?? "",
              country: company.country ?? "",
              employee_range: company.employee_range ?? "",
              status: company.status,
              notes: company.notes ?? "",
            }
          : empty,
      );
    setErrs({});
  }, [open, company]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!f.name.trim()) next.name = "Name is required.";
    const w = normalizeWebsiteResult(f.website);
    if (!w.ok) next.website = w.error;
    setErrs(next);
    if (Object.keys(next).length) return;
    const payload = {
      name: f.name.trim(),
      website: w.ok ? w.value : null,
      industry: f.industry.trim() || null,
      country: f.country.trim() || null,
      employee_range: f.employee_range || null,
      status: f.status,
      notes: f.notes.trim() || null,
    };
    setBusy(true);
    const { error } = company
      ? await supabase.from("companies").update(payload).eq("id", company.id)
      : await supabase.from("companies").insert({ ...payload, organization_id: ws.organizationId });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(company ? "Company saved" : "Company added");
    onOpenChange(false);
    onSaved();
  }

  const set = (k: keyof typeof empty) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{company ? "Edit company" : "Add company"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Name *" error={errs.name} className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => set("name")(e.target.value)} autoFocus />
          </Field>
          <Field label="Website" error={errs.website} className="sm:col-span-2" hint="Saved as https://domain">
            <Input value={f.website} onChange={(e) => set("website")(e.target.value)} placeholder="example.com" />
          </Field>
          <Field label="Industry">
            <Input value={f.industry} onChange={(e) => set("industry")(e.target.value)} />
          </Field>
          <Field label="Country">
            <Input value={f.country} onChange={(e) => set("country")(e.target.value)} />
          </Field>
          <Field label="Employees">
            <OptionSelect value={f.employee_range} onChange={set("employee_range")} options={EMPLOYEE_RANGES} placeholder="Unknown" allowAny />
          </Field>
          <Field label="Status">
            <OptionSelect value={f.status} onChange={set("status")} options={COMPANY_STATUSES} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={f.notes} onChange={(e) => set("notes")(e.target.value)} rows={3} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
