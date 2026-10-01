import { createHash } from "node:crypto";
import Papa from "papaparse";
import { isOfficialAustralianProcurementUrl, type RawTender } from "./tenders.ts";
import snapshot from "./data/queensland-pipeline-snapshot.json" with { type: "json" };

const PORTAL = "https://www.data.qld.gov.au";
const DATASET = "forward-procurement-pipeline";
const FALLBACK_RESOURCE = "d3968658-dbb7-4732-bc19-467c49de23de";
const MAX_BYTES = 4 * 1024 * 1024;
const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RELEVANT = /\b(?:solar|photovoltaic|pv|battery|batteries|bess|energy storage|renewable|microgrid|off[- ]grid|hybrid power|electric(?:al|ity)?|power (?:system|supply|infrastructure|station|generation)|generator|substation|transformer|switchboard|high voltage|low voltage|ev charging|electric vehicle|electrification|charging infrastructure|lithium|inverter|decarboni[sz]\w*|distributed energy|hydrogen)\b/i;

type PipelineRow = Record<string, string | number | null>;

export function parseQueenslandPipelineCsv(csv: string): PipelineRow[] {
  const parsed = Papa.parse<PipelineRow>(csv.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), {
    header: true,
    delimiter: ",",
    newline: "\n",
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  const fields = parsed.meta.fields ?? [];
  if (!["Agency", "Program Description"].every((field) => fields.includes(field))) {
    throw new Error("Queensland CSV is empty or does not contain the published pipeline columns.");
  }
  if (parsed.errors.length) throw new Error("Queensland CSV is incomplete or malformed.");
  const rows = parsed.data.filter((row) => row["Agency"] && row["Program Description"]);
  if (!rows.length) throw new Error("Queensland CSV contained no procurement records.");
  return rows;
}

export function normalizeQueenslandPipeline(rows: PipelineRow[], resourceId: string): RawTender[] {
  const sourceUrl = `${PORTAL}/dataset/${DATASET}/resource/${resourceId}`;
  return rows.flatMap((row) => {
    const value = (field: string) => String(row[field] ?? "").trim();
    const title = value("Program Description");
    const issuer = value("Agency");
    const categoryGroup = value("Category Group");
    const category = value("Category");
    if (!title || !issuer || !RELEVANT.test([title, categoryGroup, category, value("Business Unit")].join(" "))) return [];

    // The published CSV has no _id. Datastore row numbers can also change when
    // the publisher replaces the file, so identity comes from source content.
    const identity = [issuer, title, categoryGroup, category].map((part) => part.toLowerCase().replace(/\s+/g, " ")).join("|");
    const sourceSpecificId = "qld-fpp-" + createHash("sha256").update(identity).digest("hex").slice(0, 24);
    const method = value("Procurement Method");
    const timing = value("Estimated Timing for Release to Market");
    const spend = value("Spend Range");
    const funding = value("Funding Status");
    const region = value("Region SA4") || value("Agency Region");
    const link = value("Link");
    const summary = [
      categoryGroup ? `Category group: ${categoryGroup}.` : "",
      category ? `Category: ${category}.` : "",
      timing ? `Estimated release to market: ${timing}.` : "",
      method ? `Procurement method: ${method}.` : "",
      spend ? `Published estimated spend range: ${spend}.` : "",
      funding ? `Funding status: ${funding}.` : "",
    ].filter(Boolean).join(" ");

    return [{
      sourceName: "Queensland Government Forward Procurement Pipeline",
      sourceSpecificId, sourceUrl,
      tenderTitle: title.slice(0, 500), issuer: issuer.slice(0, 240),
      referenceNumber: null,
      opportunityType: method ? `Forward procurement · ${method}` : "Forward procurement",
      category: [categoryGroup, category].filter(Boolean).join(" · ").slice(0, 500) || null,
      summary: summary.slice(0, 2000) || null,
      publishedDateRaw: null, closingDateRaw: null,
      timezone: "Australia/Brisbane", country: "Australia", state: "QLD",
      location: region ? `${region}, Queensland` : "Queensland",
      documentedContractValue: null,
      tenderDocumentLinks: isOfficialAustralianProcurementUrl(link) ? [link] : [],
      sourceStatus: "unknown" as const,
    }];
  });
}

async function getText(url: string, accept: string): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": "SPA-Intelligence-Tender-Monitor/1.0 (+https://spa-intelligence.onrender.com)" },
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) throw new Error(`Queensland source returned HTTP ${response.status}.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Queensland source returned an empty body.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("Queensland response exceeded the retrieval size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) throw new Error("Queensland source returned an empty body.");
  return text;
}

export async function retrieveQueenslandPipeline(): Promise<RawTender[]> {
  let resourceId = FALLBACK_RESOURCE;
  let csvUrl: string | null = null;
  const failures: string[] = [];
  try {
    const metadata = JSON.parse(await getText(`${PORTAL}/api/3/action/package_show?id=${DATASET}`, "application/json"));
    const resource = metadata.result?.resources?.find((item: { name?: string; format?: string; id?: string; url?: string }) =>
      /forward procurement pipeline/i.test(item.name ?? "") && (item.format ?? "").toLowerCase() === "csv"
    );
    if (resource?.id && /^[a-f0-9-]{36}$/i.test(resource.id)) resourceId = resource.id;
    if (resource?.url && new URL(resource.url).origin === PORTAL) csvUrl = resource.url;
  } catch {
    // Keep the verified resource as a fallback when metadata is unavailable.
  }

  const csvUrls = [`${PORTAL}/datastore/dump/${resourceId}?bom=True`, ...(csvUrl ? [csvUrl] : [])];
  for (const url of csvUrls) {
    try {
      const rows = parseQueenslandPipelineCsv(await getText(url, "text/csv,text/plain,*/*"));
      return normalizeQueenslandPipeline(rows, resourceId);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "CSV retrieval failed.");
    }
  }

  try {
    const rows: PipelineRow[] = [];
    // Bound pagination. Refuse an incomplete snapshot instead of labelling it
    // successful if the publisher expands beyond the supported page budget.
    for (let offset = 0; offset < 5000; offset += 1000) {
      const payload = JSON.parse(await getText(`${PORTAL}/api/3/action/datastore_search?resource_id=${resourceId}&limit=1000&offset=${offset}`, "application/json"));
      if (!payload.success || !Array.isArray(payload.result?.records)) throw new Error("Queensland CKAN returned invalid records.");
      rows.push(...payload.result.records);
      const total = Number(payload.result.total ?? rows.length);
      if (total > 5000) throw new Error("Queensland dataset exceeded the 5,000-row retrieval limit.");
      if (rows.length >= total && rows.length) return normalizeQueenslandPipeline(rows, resourceId);
      if (!payload.result.records.length) throw new Error("Queensland CKAN returned an incomplete snapshot.");
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "CKAN retrieval failed.");
  }
  const age = Date.now() - Date.parse(snapshot.retrievedAt);
  if (age >= 0 && age <= SNAPSHOT_MAX_AGE_MS) {
    return snapshot.records.map((row) => ({
      ...row,
      sourceStatus: "unknown",
      retrievalMethod: "cached",
      sourceRetrievedAt: snapshot.retrievedAt,
    })) as RawTender[];
  }
  throw new Error(`Queensland pipeline retrieval failed: ${failures.join(" ")} The dated fallback is too old to use.`);
}
