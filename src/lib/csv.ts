import Papa from "papaparse";

export const IMPORT_ROW_CAP = 2000;
export const BATCH_SIZE = 500;

export function parseCsv(text: string): { rows: Record<string, string>[]; error?: string } {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (res.errors.length && !res.data.length) return { rows: [], error: res.errors[0]!.message };
  return { rows: res.data };
}

/** Neutralize spreadsheet formula injection. */
export function safeCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  return Papa.unparse({
    fields: headers,
    data: rows.map((r) => headers.map((h) => safeCell(r[h]))),
  });
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
