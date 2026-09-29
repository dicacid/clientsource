import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiJson, AiError } from "./ai.server";
import { extractEmails, extractLinks, fetchPage, hostOf, htmlToText, pageMeta } from "./web.server";

export type Analysis = {
  business_name: string;
  one_liner: string;
  what_it_does: string;
  value_proposition: string;
  ideal_customers: string[];
  target_industries: string[];
  target_titles: string[];
  pain_points: string[];
};

export type Target = {
  name: string;
  domain: string;
  industry: string;
  country: string;
  employee_range: string;
  why_fit: string;
};

export type ContactResult = {
  contact_name: string | null;
  contact_title: string | null;
  email: string | null;
  email_type: "person" | "generic" | "none";
  source_url: string | null;
  emails_found: string[];
  subject: string;
  body: string;
};

async function assertMember(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error || !data) throw new Error("You must be a workspace member to use the prospect finder.");
  return data.organization_id as string;
}

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    if (e instanceof AiError) throw new Error(e.message);
    throw e;
  });
}

const analysisSchema = z.object({
  business_name: z.string().max(200),
  one_liner: z.string().max(500),
  what_it_does: z.string().max(3000),
  value_proposition: z.string().max(2000),
  ideal_customers: z.array(z.string().max(300)).max(12),
  target_industries: z.array(z.string().max(120)).max(12),
  target_titles: z.array(z.string().max(120)).max(12),
  pain_points: z.array(z.string().max(300)).max(12),
});

export const analyzeBusiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ website: z.string().min(3).max(300) }).parse(d))
  .handler(({ data, context }) =>
    wrap(async () => {
      await assertMember(context);
      const host = hostOf(data.website);
      if (!host) throw new Error("Enter a valid website like cadenceops.app");
      const home = (await fetchPage(`https://${host}`)) ?? (await fetchPage(`https://www.${host}`));
      if (!home) throw new Error(`Couldn't open https://${host}. Check the address and that the site is public.`);
      const meta = pageMeta(home.html);
      const extra = extractLinks(home.html, home.url).slice(0, 2);
      const pages = (await Promise.all(extra.map((u) => fetchPage(u, 5000)))).filter(Boolean) as { html: string }[];
      const text = [htmlToText(home.html, 7000), ...pages.map((p) => htmlToText(p.html, 2500))].join("\n---\n");
      const a = await aiJson<Analysis>(
        "You are a B2B go-to-market analyst. Read a company's website text and explain precisely what the business sells, to whom, and who would benefit most. Be concrete; never invent features not supported by the text.",
        `Website: https://${host}\nTitle: ${meta.title}\nMeta description: ${meta.description}\n\nPage text:\n${text}\n\nReturn JSON with keys: business_name, one_liner (max 25 words), what_it_does (2-4 sentences), value_proposition (1-2 sentences), ideal_customers (4-6 concrete customer profiles), target_industries (4-8), target_titles (3-6 decision-maker job titles who would buy), pain_points (3-5 problems it solves).`,
        "medium",
      );
      return { website: `https://${host}`, analysis: analysisSchema.parse(a) };
    }),
  );

export const discoverTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        website: z.string().max(300),
        analysis: analysisSchema,
        exclude: z.array(z.string().max(200)).max(200).default([]),
      })
      .parse(d),
  )
  .handler(({ data, context }) =>
    wrap(async () => {
      const orgId = await assertMember(context);
      const { data: existing } = await context.supabase.from("companies").select("website").eq("organization_id", orgId).not("website", "is", null).limit(2000);
      const skip = new Set<string>([
        hostOf(data.website) ?? "",
        ...data.exclude.map((d) => hostOf(d) ?? d),
        ...((existing ?? []) as { website: string }[]).map((c) => hostOf(c.website) ?? ""),
      ]);
      const res = await aiJson<{ companies: Target[] }>(
        "You are a B2B prospecting researcher. Propose REAL, currently operating small and mid-sized companies (not Fortune 500 giants) that would clearly benefit from the described product. Only include companies you are confident exist, with their real primary website domain. Prefer a mix of countries in the product's likely market.",
        `Product: ${data.analysis.business_name} — ${data.analysis.one_liner}\nWhat it does: ${data.analysis.what_it_does}\nIdeal customers: ${data.analysis.ideal_customers.join("; ")}\nTarget industries: ${data.analysis.target_industries.join(", ")}\nPain points: ${data.analysis.pain_points.join("; ")}\nDo NOT include these domains: ${[...skip].filter(Boolean).slice(0, 150).join(", ") || "none"}\n\nReturn JSON {"companies":[...]} with 16 items, each: name, domain (bare domain, no protocol), industry, country, employee_range (one of 1-10, 11-50, 51-200, 201-1000, 1000+), why_fit (one specific sentence tying their business to the product).`,
      );
      const candidates = (res.companies ?? [])
        .map((c) => ({ ...c, domain: hostOf(String(c.domain ?? "")) ?? "" }))
        .filter((c) => c.domain && c.name && !skip.has(c.domain));
      // Verify each domain is a live public website.
      const checked = await Promise.all(
        candidates.slice(0, 16).map(async (c) => ((await fetchPage(`https://${c.domain}`, 6000)) ? c : null)),
      );
      const ranges = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
      return {
        targets: checked
          .filter((c): c is Target => !!c)
          .slice(0, 10)
          .map((c) => ({
            name: String(c.name).slice(0, 200),
            domain: c.domain,
            industry: String(c.industry ?? "").slice(0, 120),
            country: String(c.country ?? "").slice(0, 80),
            employee_range: ranges.includes(c.employee_range) ? c.employee_range : "",
            why_fit: String(c.why_fit ?? "").slice(0, 500),
          })),
      };
    }),
  );

const targetSchema = z.object({
  name: z.string().max(200),
  domain: z.string().max(200),
  industry: z.string().max(120),
  country: z.string().max(80),
  employee_range: z.string().max(20),
  why_fit: z.string().max(500),
});

export const researchAndDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        target: targetSchema,
        analysis: analysisSchema,
        website: z.string().max(300),
        sender: z.object({ name: z.string().min(1).max(120), email: z.string().email().max(200) }),
      })
      .parse(d),
  )
  .handler(({ data, context }): Promise<ContactResult> =>
    wrap(async () => {
      await assertMember(context);
      const domain = hostOf(data.target.domain);
      if (!domain) throw new Error("Invalid company domain");
      const home = await fetchPage(`https://${domain}`, 7000);
      const links = home ? extractLinks(home.html, home.url) : [];
      const fallbacks = ["/contact", "/about", "/team", "/about-us", "/contact-us"].map((p) => `https://${domain}${p}`);
      const urls = [...new Set([...links, ...fallbacks])].slice(0, 5);
      const pages = [home, ...(await Promise.all(urls.map((u) => fetchPage(u, 6000))))].filter(Boolean) as { url: string; html: string }[];
      const emails = [...new Set(pages.flatMap((p) => extractEmails(p.html, domain)))].slice(0, 15);
      const corpus = pages.map((p) => `URL: ${p.url}\n${htmlToText(p.html, 2500)}`).join("\n---\n").slice(0, 12000);

      const r = await aiJson<{
        contact_name: string | null;
        contact_title: string | null;
        email: string | null;
        source_url: string | null;
        subject: string;
        body: string;
      }>(
        "You research B2B prospects and write short, specific cold outreach emails. Use ONLY facts present in the provided page text. Never invent people or email addresses.",
        `Target company: ${data.target.name} (${domain}) — ${data.target.industry}, ${data.target.country}\nWhy they fit: ${data.target.why_fit}\n\nPreferred decision-maker titles: ${data.analysis.target_titles.join(", ")}\n\nEmails found on their public site: ${emails.join(", ") || "none"}\n\nTheir public pages:\n${corpus || "(site text unavailable)"}\n\n---\nSender: ${data.sender.name} <${data.sender.email}>\nSender's product: ${data.analysis.business_name} (${data.website}) — ${data.analysis.one_liner}\nValue proposition: ${data.analysis.value_proposition}\nPain points solved: ${data.analysis.pain_points.join("; ")}\n\nTasks:\n1. Pick the best decision-maker named in the page text (prefer the titles above; founders/owners/CEOs are fine for small firms). If no person is named, contact_name and contact_title are null.\n2. Pick the best email ONLY from the "Emails found" list (a personal address for that person if present, otherwise the most relevant general inbox like hello@/info@/sales@). If the list is empty, email is null.\n3. source_url: the page URL where the person or email appeared, or null.\n4. Write a personalized cold email from the sender: subject (max 8 words, no clickbait) and body (90-140 words, plain text). Greet the contact by first name if known, else "Hi ${data.target.name} team". Reference one concrete detail about their business from the page text, connect it to one pain point, one sentence on the product, a low-friction ask (15-minute call or quick reply), sign off with the sender's name and website. Include a final line: "If this isn't relevant, just reply and I won't follow up." No placeholders in brackets.\n\nReturn JSON with keys: contact_name, contact_title, email, source_url, subject, body.`,
      );

      const lowerCorpus = corpus.toLowerCase();
      const email = r.email && emails.includes(r.email.toLowerCase()) ? r.email.toLowerCase() : emails.find((e) => e.endsWith(domain)) ?? null;
      const name = r.contact_name && lowerCorpus.includes(r.contact_name.toLowerCase().split(" ").pop() ?? "~~") ? r.contact_name.slice(0, 120) : null;
      const generic = email ? /^(info|hello|contact|sales|support|team|office|admin|enquiries|inquiries|mail|hi)@/.test(email) : false;
      return {
        contact_name: name,
        contact_title: name ? (r.contact_title?.slice(0, 120) ?? null) : null,
        email,
        email_type: email ? (generic ? "generic" : "person") : "none",
        source_url: r.source_url && pages.some((p) => p.url === r.source_url) ? r.source_url : (pages[0]?.url ?? null),
        emails_found: emails,
        subject: String(r.subject ?? "").slice(0, 200),
        body: String(r.body ?? "").slice(0, 4000),
      };
    }),
  );
