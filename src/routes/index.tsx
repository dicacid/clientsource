import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  Check,
  ClipboardList,
  FileUp,
  Globe2,
  ListChecks,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Prospect Finder B2B | Free business, prospect and competitor research" },
      {
        name: "description",
        content:
          "Understand a business, research competitors, discover potential B2B customers and organise leads. Free to use, no login or website required to get started.",
      },
      { property: "og:title", content: "Prospect Finder B2B | Free business and competitor research" },
      {
        property: "og:description",
        content:
          "Find business information, possible competitors and sales opportunities using public sources. Get started free without signing in.",
      },
      { property: "og:url", content: "https://prospect-finder-b2b.onrender.com/" },
      { name: "robots", content: "index, follow" },
    ],
    links: [{ rel: "canonical", href: "https://prospect-finder-b2b.onrender.com/" }],
  }),
  component: WelcomePage,
});

const features = [
  {
    icon: Search,
    title: "Research any business by name",
    description: "Enter a business name, with optional location and industry. A website is not required.",
  },
  {
    icon: Building2,
    title: "Explore possible competitors",
    description: "Find comparable businesses and inspect the public sources behind the suggestions.",
  },
  {
    icon: Target,
    title: "Discover B2B opportunities",
    description: "Optionally analyse your own website to discover companies that may fit what you sell.",
  },
  {
    icon: Users,
    title: "Manage companies and contacts",
    description: "Save promising businesses, add contacts, track their status and plan follow-ups.",
  },
  {
    icon: ClipboardList,
    title: "Review prospect intelligence",
    description: "Keep research notes, qualification details and draft outreach together for review.",
  },
  {
    icon: FileUp,
    title: "Import existing leads",
    description: "Bring company or contact lists in from a CSV file and work from your dashboard.",
  },
] as const;

const steps = [
  {
    label: "01",
    title: "Open the research tool",
    description: "Choose Start researching. There is no sign-up, invitation or payment step.",
  },
  {
    label: "02",
    title: "Tell it what to look for",
    description: "Enter a business name. Add a town, suburb or industry to narrow the search, and leave Include competitors on if useful.",
  },
  {
    label: "03",
    title: "Check the findings",
    description: "Review public references and possible competitor matches. Follow the evidence links to confirm what is accurate.",
  },
  {
    label: "04",
    title: "Turn research into action",
    description: "Save relevant businesses to Companies, add Contacts and manage next steps on your Dashboard.",
  },
] as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs font-medium uppercase tracking-[0.17em] text-primary">{children}</p>;
}

function WelcomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main"
        className="sr-only rounded bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link to="/" aria-label="Prospect Finder B2B home" className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <Search className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold tracking-tight sm:text-base">Prospect Finder B2B</span>
              <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:block">Business intelligence tools</span>
            </span>
          </Link>
          <nav aria-label="Welcome page" className="hidden items-center gap-7 md:flex">
            <a href="#what-it-does" className="text-sm text-muted-foreground transition-colors hover:text-foreground">What it does</a>
            <a href="#how-to-use" className="text-sm text-muted-foreground transition-colors hover:text-foreground">How to use it</a>
            <a href="#questions" className="text-sm text-muted-foreground transition-colors hover:text-foreground">FAQs</a>
          </nav>
          <Link
            to="/prospect"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Start free <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main id="main">
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 opacity-[0.045]" style={{ backgroundImage: "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)", backgroundSize: "52px 52px" }} aria-hidden="true" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16 lg:py-28">
            <div className="max-w-2xl">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wider text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                Free business research platform
              </div>
              <h1 className="text-4xl font-bold leading-[1.07] tracking-tight sm:text-5xl lg:text-[3.75rem]">
                Find businesses.
                <br />
                Understand your market.
                <br />
                <span className="text-primary">Find your next opportunity.</span>
              </h1>
              <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                Prospect Finder B2B helps small businesses, freelancers and sales teams research other companies, investigate competitors and identify potential customers using public information.
              </p>
              <p className="mt-4 max-w-xl text-sm leading-6 text-foreground/85">
                Know the business name but not its website? That's fine. Start with a name, a location or an industry.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/prospect"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Start researching <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a
                  href="#how-to-use"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-border bg-card px-5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <BookOpen className="h-4 w-4" aria-hidden="true" /> See how it works
                </a>
              </div>
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground sm:text-sm">
                <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" aria-hidden="true" /> No login needed</span>
                <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" aria-hidden="true" /> No website needed</span>
                <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" aria-hidden="true" /> Free to use</span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 shadow-2xl shadow-black/20 sm:p-6" aria-label="Illustration of the business research workflow">
              <div className="flex items-start justify-between gap-2 border-b border-border pb-4">
                <div>
                  <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-primary">How a search works</p>
                  <h2 className="mt-1 text-base font-semibold sm:text-lg">From a name to a shortlist</h2>
                </div>
                <span className="rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground">EXAMPLE</span>
              </div>
              <div className="mt-5 rounded-lg border border-border bg-background p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Search className="h-4 w-4 text-primary" aria-hidden="true" /> START WITH
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Business name</div>
                    <div className="rounded border border-border bg-card px-3 py-2 text-sm font-medium">A local manufacturer</div>
                  </div>
                  <div>
                    <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Location (optional)</div>
                    <div className="rounded border border-border bg-card px-3 py-2 text-sm font-medium">Newcastle, NSW</div>
                  </div>
                </div>
                <div className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> No website field required
                </div>
              </div>
              <div className="mx-7 h-5 border-l border-dashed border-primary/50" aria-hidden="true" />
              <div className="grid gap-2">
                {[
                  { number: "01", title: "Public business references", detail: "Source links to review" },
                  { number: "02", title: "Possible competitors", detail: "Comparable company suggestions" },
                  { number: "03", title: "Your saved shortlist", detail: "Companies, contacts and follow-ups" },
                ].map((item) => (
                  <div key={item.number} className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-xs font-semibold text-primary">{item.number}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{item.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{item.detail}</div>
                    </div>
                    <Check className="ml-auto h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">Illustrative workflow only. Actual results depend on available public information and must be verified.</p>
            </div>
          </div>
        </section>

        <section id="what-it-does" className="scroll-mt-24 py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <SectionLabel>01 / What it does</SectionLabel>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
              <div>
                <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Research, qualify and organise in one place.</h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
                  Built to turn scattered business information into a useful prospecting workflow, not just a list of company names.
                </p>
              </div>
              <Link to="/prospect" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
                Explore the research tool <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <article key={feature.title} className="rounded-lg border border-border bg-card p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                    <feature.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 text-base font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-to-use" className="scroll-mt-24 border-y border-border bg-card/40 py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <SectionLabel>02 / How to use it</SectionLabel>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Your first search, in four steps.</h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              No technical setup. Start with a business you want to learn about or an industry you want to explore.
            </p>
            <ol className="mt-9 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {steps.map((step) => (
                <li key={step.label} className="rounded-lg border border-border bg-card p-5">
                  <span className="font-mono text-2xl font-semibold text-primary">{step.label}</span>
                  <h3 className="mt-5 text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
                </li>
              ))}
            </ol>
            <div className="mt-8">
              <Link
                to="/prospect"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Try your first search <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <SectionLabel>03 / Two ways to start</SectionLabel>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">With a website or without one.</h2>
            <div className="mt-9 grid gap-5 lg:grid-cols-2">
              <article className="flex flex-col rounded-xl border border-primary/30 bg-card p-6 sm:p-8">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"><Search className="h-4 w-4" aria-hidden="true" /> Most straightforward</div>
                <h3 className="mt-4 text-2xl font-semibold">I have a business name</h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  Want to look into a company that has no website, or understand who else operates in its market? Enter its name, optionally add the town and industry, then request competitor suggestions.
                </p>
                <ul className="my-6 space-y-3 text-sm">
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Business-name research</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Public evidence and source links</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Possible competitors to investigate</li>
                </ul>
                <Link to="/prospect" className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">Research a business <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              </article>

              <article className="flex flex-col rounded-xl border border-border bg-card p-6 sm:p-8">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Globe2 className="h-4 w-4" aria-hidden="true" /> Optional workflow</div>
                <h3 className="mt-4 text-2xl font-semibold">I have my own website</h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  Want to find potential buyers for what your company offers? In Prospect finder, expand the optional website section, enable website mode and enter your business details.
                </p>
                <ul className="my-6 space-y-3 text-sm">
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Analyse your business offering</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Look for suitable B2B prospects</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Review suggested outreach drafts when AI is available</li>
                </ul>
                <Link to="/prospect" className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">Explore website mode <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              </article>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-card/40 py-12">
          <div className="mx-auto grid max-w-7xl gap-5 px-5 sm:px-8 md:grid-cols-[auto_1fr] md:gap-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></div>
            <div>
              <h2 className="text-lg font-semibold">A note about guest access and research accuracy</h2>
              <p className="mt-2 max-w-4xl text-sm leading-7 text-muted-foreground">
                You can explore the tools without an account. Guest-saved companies, contacts and research stay in your current browser tab; they are not synced across devices, so copy anything important before closing it. Public listings can be incomplete or outdated, and suggested competitors are leads to verify, not confirmed relationships. The platform does not send outreach automatically. AI-assisted features depend on service availability.
              </p>
            </div>
          </div>
        </section>

        <section id="questions" className="scroll-mt-24 py-16 sm:py-20">
          <div className="mx-auto max-w-4xl px-5 sm:px-8">
            <SectionLabel>04 / Common questions</SectionLabel>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Good to know before you start.</h2>
            <div className="mt-8 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {[
                {
                  q: "Do I need to create an account?",
                  a: "No. Open Prospect finder and start researching. Creating an account is only relevant if you need an identified, shared team workspace.",
                },
                {
                  q: "What if the company does not have a website?",
                  a: "You can still enter its business name and optionally a location or industry. The tool searches public references and may suggest comparable businesses without assuming a website exists.",
                },
                {
                  q: "Can I use it to find new customers?",
                  a: "Yes. The optional website mode can analyse what your business offers and help identify matching B2B prospects. Any AI-generated analysis and email drafts should be reviewed before use.",
                },
                {
                  q: "Are the competitors and contact details verified?",
                  a: "Not automatically. Check the source links and confirm each business, relationship and contact before relying on the results.",
                },
                {
                  q: "Will my guest research be saved permanently?",
                  a: "No. Anonymous saved data is browser-tab local and is not guaranteed to survive closing the tab or clearing browser data. Copy important findings before you leave.",
                },
              ].map((item) => (
                <details key={item.q} className="group px-5 py-4 sm:px-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold sm:text-base">
                    {item.q}
                    <span className="shrink-0 font-mono text-lg text-primary transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-card/50 py-14">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-5 sm:px-8 md:flex-row md:items-center">
            <div>
              <SectionLabel>Ready to get started?</SectionLabel>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Find your next business opportunity.</h2>
              <p className="mt-2 text-sm text-muted-foreground">Start with a business name. No website, login or payment needed.</p>
            </div>
            <Link to="/prospect" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
              Open Prospect finder <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 text-xs text-muted-foreground sm:px-8">
          <span className="inline-flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Prospect Finder B2B</span>
          <span>Public-source business research. Verify before contacting anyone.</span>
          <a href="#main" className="hover:text-foreground">Back to top ↑</a>
        </div>
      </footer>
    </div>
  );
}
