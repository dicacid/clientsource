import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, PartyPopper, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { renderDb } from "@/integrations/render/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDelete, EmptyState, PageHeader } from "@/components/crm/shared";
import { friendlyError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/_app/party")({
  head: () => ({
    meta: [
      { title: "Party mode - Prospect Finder B2B" },
      { name: "description", content: "Shape an event, shortlist the people and resources it needs, then hand it off to CadenceOps." },
      { property: "og:title", content: "Party mode - Prospect Finder B2B" },
      { property: "og:description", content: "Collaborative event discovery and shaping with a clean CadenceOps handoff." },
    ],
  }),
  component: PartyMode,
});

type EventStatus = "idea" | "shaping" | "ready_for_handoff";
type ResourceStatus = "idea" | "shortlist" | "confirmed" | "passed";
type ResourceCategory = "artist" | "venue" | "production" | "crew" | "supplier" | "other";

type PartyResource = {
  id: string;
  category: ResourceCategory;
  name: string;
  status: ResourceStatus;
  url: string | null;
  location: string | null;
  notes: string;
  added_by: string;
  created_at: string;
};

type PartyEvent = {
  id: string;
  organization_id: string;
  name: string;
  concept: string;
  location: string;
  date_window: string;
  attendance: string;
  vibe: string;
  status: EventStatus;
  requirements: string[];
  resources: PartyResource[];
  notes: string;
  created_by: string;
  updated_by: string;
  updated_at: string;
  created_at: string;
};

type WorkspaceMember = {
  user_id: string;
  role: string;
  name: string | null;
};

const categoryLabel: Record<ResourceCategory, string> = {
  artist: "Artists / DJs",
  venue: "Venues",
  production: "Production",
  crew: "Crew",
  supplier: "Suppliers",
  other: "Other",
};

const statusLabel: Record<EventStatus, string> = {
  idea: "Idea",
  shaping: "Shaping",
  ready_for_handoff: "Ready for CadenceOps",
};

const resourceStatusLabel: Record<ResourceStatus, string> = {
  idea: "Idea",
  shortlist: "Shortlist",
  confirmed: "Confirmed",
  passed: "Passed",
};

function cloneEvent(event: PartyEvent): PartyEvent {
  return {
    ...event,
    requirements: [...(event.requirements ?? [])],
    resources: (event.resources ?? []).map((resource) => ({ ...resource })),
  };
}

function safeUrl(value: string | null) {
  if (!value) return null;
  try {
    const next = /^https?:\/\//i.test(value) ? value : "https://" + value;
    const parsed = new URL(next);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function PartyMode() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PartyEvent | null>(null);
  const [newEventName, setNewEventName] = useState("");
  const [requirement, setRequirement] = useState("");
  const [resourceName, setResourceName] = useState("");
  const [resourceCategory, setResourceCategory] = useState<ResourceCategory>("artist");
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceLocation, setResourceLocation] = useState("");
  const [resourceNotes, setResourceNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const eventsQuery = useQuery({
    queryKey: ["party-events", ws.organizationId],
    queryFn: async () => {
      const { data, error } = await renderDb
        .from("party_events")
        .select("*")
        .eq("organization_id", ws.organizationId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PartyEvent[];
    },
  });

  const membersQuery = useQuery({
    queryKey: ["party-members", ws.organizationId],
    queryFn: async () => {
      const { data: members, error } = await renderDb
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", ws.organizationId)
        .order("created_at");
      if (error) throw error;
      const ids = (members ?? []).map((member: { user_id: string }) => member.user_id);
      if (!ids.length) return [] as WorkspaceMember[];
      const { data: profiles, error: profileError } = await renderDb.from("profiles").select("id, full_name").in("id", ids);
      if (profileError) throw profileError;
      const names = Object.fromEntries((profiles ?? []).map((profile: { id: string; full_name: string | null }) => [profile.id, profile.full_name]));
      return (members ?? []).map((member: { user_id: string; role: string }) => ({
        ...member,
        name: (names[member.user_id] as string | null | undefined) ?? null,
      })) as WorkspaceMember[];
    },
  });

  useEffect(() => {
    const events = eventsQuery.data ?? [];
    if (!events.length) {
      setSelectedId(null);
      setDraft(null);
      return;
    }
    if (!selectedId || !events.some((event) => event.id === selectedId)) setSelectedId(events[0]!.id);
  }, [eventsQuery.data, selectedId]);

  const selected = (eventsQuery.data ?? []).find((event) => event.id === selectedId) ?? null;

  useEffect(() => {
    setDraft(selected ? cloneEvent(selected) : null);
  }, [selected?.id, selected?.updated_at]);

  async function createEvent(e: FormEvent) {
    e.preventDefault();
    const name = newEventName.trim();
    if (!name) return toast.error("Give the event a name.");
    const { data, error } = await renderDb
      .from("party_events")
      .insert({
        organization_id: ws.organizationId,
        name,
        concept: "",
        location: "",
        date_window: "",
        attendance: "",
        vibe: "",
        status: "idea",
        requirements: [],
        resources: [],
        notes: "",
      })
      .select("*")
      .single();
    if (error) return toast.error(friendlyError(error));
    setNewEventName("");
    setSelectedId((data as PartyEvent).id);
    await qc.invalidateQueries({ queryKey: ["party-events"] });
    toast.success("Event workspace created");
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Event name cannot be blank.");
    setSaving(true);
    const { error } = await renderDb
      .from("party_events")
      .update({
        name: draft.name.trim(),
        concept: draft.concept,
        location: draft.location,
        date_window: draft.date_window,
        attendance: draft.attendance,
        vibe: draft.vibe,
        status: draft.status,
        requirements: draft.requirements,
        resources: draft.resources,
        notes: draft.notes,
      })
      .eq("id", draft.id);
    setSaving(false);
    if (error) return toast.error(friendlyError(error));
    await qc.invalidateQueries({ queryKey: ["party-events"] });
    toast.success("Party workspace saved");
  }

  async function deleteEvent(id: string) {
    const { error } = await renderDb.from("party_events").delete().eq("id", id);
    if (error) return toast.error(friendlyError(error));
    setSelectedId(null);
    await qc.invalidateQueries({ queryKey: ["party-events"] });
    toast.success("Event removed");
  }

  function addRequirement(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const next = requirement.trim();
    if (!next) return;
    if (draft.requirements.some((item) => item.toLowerCase() === next.toLowerCase())) return toast.message("That search parameter is already there.");
    setDraft({ ...draft, requirements: [...draft.requirements, next] });
    setRequirement("");
  }

  function addResource(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const name = resourceName.trim();
    if (!name) return toast.error("Name the artist, venue, supplier or resource.");
    const resource: PartyResource = {
      id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8),
      category: resourceCategory,
      name,
      status: "idea",
      url: resourceUrl.trim() || null,
      location: resourceLocation.trim() || null,
      notes: resourceNotes.trim(),
      added_by: ws.userId,
      created_at: new Date().toISOString(),
    };
    setDraft({ ...draft, resources: [...draft.resources, resource] });
    setResourceName("");
    setResourceUrl("");
    setResourceLocation("");
    setResourceNotes("");
  }

  function updateResource(id: string, patch: Partial<PartyResource>) {
    if (!draft) return;
    setDraft({
      ...draft,
      resources: draft.resources.map((resource) => (resource.id === id ? { ...resource, ...patch } : resource)),
    });
  }

  function removeResource(id: string) {
    if (!draft) return;
    setDraft({ ...draft, resources: draft.resources.filter((resource) => resource.id !== id) });
  }

  function exportCadenceOps() {
    if (!draft) return;
    const members = membersQuery.data ?? [];
    const payload = {
      schema: "cadenceops.event-handoff.v1",
      source: {
        product: "Prospect Finder B2B",
        mode: "party",
        event_id: draft.id,
        exported_at: new Date().toISOString(),
      },
      event: {
        name: draft.name,
        concept: draft.concept,
        location: draft.location,
        date_window: draft.date_window,
        attendance: draft.attendance,
        vibe: draft.vibe,
        discovery_status: draft.status,
        notes: draft.notes,
      },
      discovery: {
        search_parameters: draft.requirements,
        resources: draft.resources,
      },
      collaboration: {
        workspace_name: ws.orgName,
        members: members.map((member) => ({
          name: member.name,
          role: member.role,
        })),
      },
      handoff: {
        party_mode_scope: "event discovery, concept shaping, people and resource shortlisting",
        cadenceops_scope: ["production planning", "budgets", "run sheets", "crew operations", "logistics", "show-day delivery"],
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const slug = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
    anchor.href = href;
    anchor.download = slug + "-cadenceops.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
    toast.success("CadenceOps handoff exported");
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Party mode"
        sub="Shape the event here. Production management stays in CadenceOps."
        actions={
          draft ? (
            <>
              <Button variant="outline" onClick={exportCadenceOps} className="gap-2">
                <Download className="h-4 w-4" /> Export for CadenceOps
              </Button>
              <Button onClick={saveDraft} disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <div className="font-medium">Discovery and collaboration, not show operations.</div>
            <p className="mt-1 text-muted-foreground">
              Use Party mode to work out what the event should be, who should be involved and what resources are worth pursuing. When it becomes real, export the structured handoff to CadenceOps.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <form onSubmit={createEvent} className="rounded-lg border bg-card p-4">
            <Label htmlFor="party-new-name">New event</Label>
            <Input
              id="party-new-name"
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
              placeholder="Warehouse party, bush doof..."
              className="mt-2 h-11 border-border/90 bg-background/70"
            />
            <Button type="submit" className="mt-3 w-full gap-2">
              <Plus className="h-4 w-4" /> Create event
            </Button>
          </form>

          <div className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3 text-sm font-semibold">Party workspaces</div>
            {eventsQuery.isLoading ? (
              <div className="p-4"><Skeleton className="h-24" /></div>
            ) : eventsQuery.error ? (
              <p className="p-4 text-sm text-destructive">{friendlyError(eventsQuery.error)}</p>
            ) : (eventsQuery.data ?? []).length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No events yet.</p>
            ) : (
              <div className="divide-y">
                {(eventsQuery.data ?? []).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setSelectedId(event.id)}
                    className={"w-full px-4 py-3 text-left transition-colors hover:bg-accent " + (event.id === selectedId ? "bg-accent" : "")}
                  >
                    <div className="truncate text-sm font-medium">{event.name}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{statusLabel[event.status] ?? event.status}</span>
                      <span>{event.resources?.length ?? 0} resources</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="min-w-0">
          {!draft ? (
            <EmptyState title="Create an event workspace to start shaping the idea." />
          ) : (
            <div className="space-y-6">
              <section className="rounded-lg border bg-card p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Event brief</h2>
                    <p className="text-sm text-muted-foreground">Loose is fine. This is where the idea gets shaped before production starts.</p>
                  </div>
                  <Select value={draft.status} onValueChange={(value) => setDraft({ ...draft, status: value as EventStatus })}>
                    <SelectTrigger className="h-10 w-48 border-border/90 bg-background/70" aria-label="Event status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="idea">Idea</SelectItem>
                      <SelectItem value="shaping">Shaping</SelectItem>
                      <SelectItem value="ready_for_handoff">Ready for CadenceOps</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="party-name">Event name</Label>
                    <Input id="party-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-11 border-border/90 bg-background/70" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="party-location">Location / search area</Label>
                    <Input id="party-location" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="Newcastle, Hunter, NSW" className="h-11 border-border/90 bg-background/70" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="party-date">Date / window</Label>
                    <Input id="party-date" value={draft.date_window} onChange={(e) => setDraft({ ...draft, date_window: e.target.value })} placeholder="December, Saturday night, flexible" className="h-11 border-border/90 bg-background/70" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="party-attendance">Scale</Label>
                    <Input id="party-attendance" value={draft.attendance} onChange={(e) => setDraft({ ...draft, attendance: e.target.value })} placeholder="400 people, two rooms" className="h-11 border-border/90 bg-background/70" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="party-vibe">Vibe / creative direction</Label>
                    <Input id="party-vibe" value={draft.vibe} onChange={(e) => setDraft({ ...draft, vibe: e.target.value })} placeholder="Techno, underground, proper sound, lasers..." className="h-11 border-border/90 bg-background/70" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="party-concept">Concept</Label>
                    <Textarea id="party-concept" rows={4} value={draft.concept} onChange={(e) => setDraft({ ...draft, concept: e.target.value })} placeholder="What are we trying to make happen?" className="min-h-[108px] resize-y border-border/90 bg-background/70" />
                  </div>
                </div>
              </section>

              <section className="rounded-lg border bg-card p-5">
                <div className="mb-4">
                  <h2 className="font-semibold">Search parameters</h2>
                  <p className="text-sm text-muted-foreground">These are Party Mode criteria, not CadenceOps production requirements.</p>
                </div>
                <form onSubmit={addRequirement} className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={requirement}
                    onChange={(e) => setRequirement(e.target.value)}
                    placeholder="Techno DJ, 130-140 BPM, Newcastle or Sydney..."
                    className="h-11 border-border/90 bg-background/70"
                  />
                  <Button type="submit" variant="outline" className="h-11">
                    Add parameter
                  </Button>
                </form>
                {draft.requirements.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {draft.requirements.map((item, index) => (
                      <button
                        key={item + index}
                        type="button"
                        onClick={() => setDraft({ ...draft, requirements: draft.requirements.filter((_, i) => i !== index) })}
                        className="rounded-full border bg-background px-3 py-1.5 text-xs hover:border-destructive/50 hover:text-destructive"
                        title="Remove parameter"
                      >
                        {item} ×
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-lg border bg-card p-5">
                <div className="mb-4">
                  <h2 className="font-semibold">Resource board</h2>
                  <p className="text-sm text-muted-foreground">Shortlist artists, DJs, venues, suppliers and people while the event is still being shaped.</p>
                </div>

                <form onSubmit={addResource} className="grid gap-3 rounded-md border bg-background/40 p-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="resource-category">Category</Label>
                    <Select value={resourceCategory} onValueChange={(value) => setResourceCategory(value as ResourceCategory)}>
                      <SelectTrigger id="resource-category" className="h-11 border-border/90 bg-background/70">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(categoryLabel) as ResourceCategory[]).map((category) => (
                          <SelectItem key={category} value={category}>{categoryLabel[category]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="resource-name">Name</Label>
                    <Input id="resource-name" value={resourceName} onChange={(e) => setResourceName(e.target.value)} placeholder="DJ, venue, supplier..." className="h-11 border-border/90 bg-background/70" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="resource-location">Location</Label>
                    <Input id="resource-location" value={resourceLocation} onChange={(e) => setResourceLocation(e.target.value)} placeholder="Newcastle, Sydney..." className="h-11 border-border/90 bg-background/70" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="resource-url">Website / source</Label>
                    <Input id="resource-url" value={resourceUrl} onChange={(e) => setResourceUrl(e.target.value)} placeholder="example.com" className="h-11 border-border/90 bg-background/70" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
                    <Label htmlFor="resource-notes">Why it fits / notes</Label>
                    <Textarea id="resource-notes" rows={3} value={resourceNotes} onChange={(e) => setResourceNotes(e.target.value)} placeholder="Why this one is worth considering..." className="resize-y border-border/90 bg-background/70" />
                  </div>
                  <Button type="submit" className="h-11 md:col-start-2 md:justify-self-end xl:col-start-4">
                    <Plus className="h-4 w-4" /> Add to board
                  </Button>
                </form>

                {draft.resources.length === 0 ? (
                  <div className="mt-4"><EmptyState title="No artists, venues or suppliers shortlisted yet." /></div>
                ) : (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {draft.resources.map((resource) => {
                      const href = safeUrl(resource.url);
                      return (
                        <article key={resource.id} className="rounded-md border bg-background/40 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">{categoryLabel[resource.category]}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <h3 className="font-medium">{resource.name}</h3>
                                {href && (
                                  <a href={href} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" aria-label={"Open " + resource.name}>
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                )}
                              </div>
                              {resource.location && <p className="mt-1 text-xs text-muted-foreground">{resource.location}</p>}
                            </div>
                            <Button type="button" size="icon" variant="ghost" onClick={() => removeResource(resource.id)} aria-label={"Remove " + resource.name}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          {resource.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{resource.notes}</p>}
                          <div className="mt-3">
                            <Select value={resource.status} onValueChange={(value) => updateResource(resource.id, { status: value as ResourceStatus })}>
                              <SelectTrigger className="h-9 w-36 bg-background" aria-label={"Status of " + resource.name}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(resourceStatusLabel) as ResourceStatus[]).map((status) => (
                                  <SelectItem key={status} value={status}>{resourceStatusLabel[status]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-lg border bg-card p-5">
                  <div className="flex items-start gap-3">
                    <Users className="mt-0.5 h-5 w-5 text-primary" />
                    <div>
                      <h2 className="font-semibold">Workspace collaborators</h2>
                      <p className="text-sm text-muted-foreground">Every member of this workspace can see and edit Party Mode events.</p>
                    </div>
                  </div>
                  {membersQuery.isLoading ? (
                    <Skeleton className="mt-4 h-20" />
                  ) : membersQuery.error ? (
                    <p className="mt-4 text-sm text-destructive">{friendlyError(membersQuery.error)}</p>
                  ) : (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(membersQuery.data ?? []).map((member) => (
                        <span key={member.user_id} className="rounded-full border bg-background px-3 py-1.5 text-xs">
                          {member.name || "Unnamed member"} <span className="text-muted-foreground">· {member.role}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border bg-card p-5">
                  <h2 className="font-semibold">CadenceOps boundary</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Party Mode stops at discovery, concept shaping and shortlisting. Budgets, run sheets, crew operations, logistics and show-day delivery belong in CadenceOps.
                  </p>
                  <Button variant="outline" onClick={exportCadenceOps} className="mt-4 gap-2">
                    <Download className="h-4 w-4" /> Export structured handoff
                  </Button>
                </div>
              </section>

              <section className="rounded-lg border bg-card p-5">
                <Label htmlFor="party-notes">Shared notes</Label>
                <Textarea
                  id="party-notes"
                  rows={6}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Ideas, links, loose thoughts and decisions that belong to shaping the event..."
                  className="mt-2 min-h-[140px] resize-y border-border/90 bg-background/70"
                />
              </section>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <p className="text-xs text-muted-foreground">
                  Last shared update: {draft.updated_at ? new Date(draft.updated_at).toLocaleString() : "not yet saved"}
                </p>
                <ConfirmDelete
                  title="Delete this Party Mode event?"
                  description="This removes the shared event brief and shortlist from this workspace."
                  onConfirm={() => deleteEvent(draft.id)}
                  trigger={
                    <Button variant="ghost" className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" /> Delete event
                    </Button>
                  }
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
