import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { renderDb } from "@/integrations/render/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONTACT_STATUSES, EMAIL_RE } from "@/lib/constants";
import { friendlyError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";
import { OptionSelect } from "./shared";
import { Field } from "./CompanyForm";

export type ContactRow = {
  id: string;
  company_id: string;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  status: string;
  next_follow_up: string | null;
  notes: string | null;
};

const empty = {
  company_id: "",
  full_name: "",
  job_title: "",
  email: "",
  phone: "",
  linkedin_url: "",
  status: "new",
  next_follow_up: "",
  notes: "",
};

export function useCompanyOptions() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ["company-options", ws.organizationId],
    queryFn: async () => {
      const { data, error } = await renderDb
        .from("companies")
        .select("id, name")
        .eq("organization_id", ws.organizationId)
        .order("name")
        .limit(2000);
      if (error) throw error;
      return data;
    },
  });
}

export function ContactForm({
  open,
  onOpenChange,
  contact,
  defaultCompanyId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contact?: ContactRow | null;
  defaultCompanyId?: string;
  onSaved: () => void;
}) {
  const ws = useWorkspace();
  const companies = useCompanyOptions();
  const [f, setF] = useState(empty);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open)
      setF(
        contact
          ? {
              company_id: contact.company_id,
              full_name: contact.full_name,
              job_title: contact.job_title ?? "",
              email: contact.email ?? "",
              phone: contact.phone ?? "",
              linkedin_url: contact.linkedin_url ?? "",
              status: contact.status,
              next_follow_up: contact.next_follow_up ?? "",
              notes: contact.notes ?? "",
            }
          : { ...empty, company_id: defaultCompanyId ?? "" },
      );
    setErrs({});
  }, [open, contact, defaultCompanyId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!f.full_name.trim()) next.full_name = "Name is required.";
    if (!f.company_id) next.company_id = "Choose a company.";
    if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) next.email = "Enter a valid email.";
    if (f.linkedin_url.trim() && !/^https:\/\//i.test(f.linkedin_url.trim())) next.linkedin_url = "Must start with https://";
    setErrs(next);
    if (Object.keys(next).length) return;
    const payload = {
      company_id: f.company_id,
      full_name: f.full_name.trim(),
      job_title: f.job_title.trim() || null,
      email: f.email.trim() || null,
      phone: f.phone.trim() || null,
      linkedin_url: f.linkedin_url.trim() || null,
      status: f.status,
      next_follow_up: f.next_follow_up || null,
      notes: f.notes.trim() || null,
    };
    setBusy(true);
    const { error } = contact
      ? await renderDb.from("contacts").update(payload).eq("id", contact.id)
      : await renderDb.from("contacts").insert({ ...payload, organization_id: ws.organizationId });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(contact ? "Contact saved" : "Contact added");
    onOpenChange(false);
    onSaved();
  }

  const set = (k: keyof typeof empty) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Full name *" error={errs.full_name} className="sm:col-span-2">
            <Input value={f.full_name} onChange={(e) => set("full_name")(e.target.value)} autoFocus />
          </Field>
          <Field label="Company *" error={errs.company_id} className="sm:col-span-2">
            <Select value={f.company_id || undefined} onValueChange={set("company_id")}>
              <SelectTrigger aria-label="Company">
                <SelectValue placeholder={companies.isLoading ? "Loading…" : "Choose company"} />
              </SelectTrigger>
              <SelectContent>
                {(companies.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Job title">
            <Input value={f.job_title} onChange={(e) => set("job_title")(e.target.value)} />
          </Field>
          <Field label="Status">
            <OptionSelect value={f.status} onChange={set("status")} options={CONTACT_STATUSES} />
          </Field>
          <Field label="Email" error={errs.email}>
            <Input type="email" value={f.email} onChange={(e) => set("email")(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={(e) => set("phone")(e.target.value)} />
          </Field>
          <Field label="LinkedIn URL" error={errs.linkedin_url}>
            <Input value={f.linkedin_url} onChange={(e) => set("linkedin_url")(e.target.value)} placeholder="https://" />
          </Field>
          <Field label="Next follow-up">
            <Input type="date" value={f.next_follow_up} onChange={(e) => set("next_follow_up")(e.target.value)} />
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
