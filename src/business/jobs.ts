// Reading a client's job spreadsheet (CSV): match columns, clean values, map ZIPs to metros.
import Papa from "papaparse";
import type { Job } from "../data/types";

export const TEMPLATE_COLUMNS: { key: keyof Job; required: boolean; help: string }[] = [
  { key: "job_date", required: true, help: "Move date, like 2026-06-14 or 6/14/2026" },
  { key: "origin_zip", required: true, help: "ZIP code where the move starts" },
  { key: "destination_zip", required: true, help: "ZIP code where it ends" },
  { key: "job_type", required: false, help: "Local, Long distance, Commercial, Storage or Labor only" },
  { key: "status", required: false, help: "Completed, Booked or Lost" },
  { key: "revenue", required: false, help: "Dollars billed for the job" },
  { key: "weight_lbs", required: false, help: "Shipment weight in pounds" },
  { key: "crew_hours", required: false, help: "Total crew hours" },
  { key: "lead_source", required: false, help: "Where the customer came from" },
];

export const TEMPLATE_CSV =
  "job_date,origin_zip,destination_zip,job_type,status,revenue,weight_lbs,crew_hours,lead_source\n" +
  "2026-06-14,28203,28277,Local,Completed,1850,6200,8,Google\n" +
  "2026-06-20,28105,10025,Long distance,Completed,7400,9100,14,Realtor partner\n";

const ALIASES: Record<string, keyof Job> = {
  jobdate: "job_date", date: "job_date", movedate: "job_date", servicedate: "job_date", moveday: "job_date",
  originzip: "origin_zip", origin: "origin_zip", fromzip: "origin_zip", pickupzip: "origin_zip", originpostalcode: "origin_zip", fromzipcode: "origin_zip", originzipcode: "origin_zip",
  destinationzip: "destination_zip", destination: "destination_zip", tozip: "destination_zip", destzip: "destination_zip",
  deliveryzip: "destination_zip", destinationpostalcode: "destination_zip", tozipcode: "destination_zip", destinationzipcode: "destination_zip",
  jobtype: "job_type", type: "job_type", movetype: "job_type", service: "job_type", servicetype: "job_type",
  status: "status", jobstatus: "status", outcome: "status",
  revenue: "revenue", amount: "revenue", total: "revenue", invoicetotal: "revenue", price: "revenue", sales: "revenue", revenueusd: "revenue",
  weight: "weight_lbs", weightlbs: "weight_lbs", lbs: "weight_lbs", pounds: "weight_lbs",
  crewhours: "crew_hours", hours: "crew_hours", laborhours: "crew_hours", manhours: "crew_hours",
  leadsource: "lead_source", source: "lead_source", lead: "lead_source", referral: "lead_source", referralsource: "lead_source", channel: "lead_source",
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function matchColumns(headers: string[]): Partial<Record<keyof Job, string>> {
  const out: Partial<Record<keyof Job, string>> = {};
  for (const hd of headers) {
    const key = ALIASES[norm(hd)];
    if (key && !out[key]) out[key] = hd;
  }
  return out;
}

export function parseDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    m = +mt[1]; d = +mt[2]; y = +mt[3];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
  } else if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {
    // Excel serial date (days since 1899-12-30)
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5);
    return dt.toISOString().slice(0, 10);
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** 5-digit ZIP, restoring leading zeros that spreadsheets drop (2134 -> 02134); ZIP+4 is cut to 5. */
export function parseZip(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).trim().replace(/-\d{4}$/, "").replace(/\D/g, "");
  if (digits.length === 9) return digits.slice(0, 5);
  if (digits.length >= 3 && digits.length <= 5) return digits.padStart(5, "0");
  return null;
}

export function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export function normType(raw: unknown): string | null {
  const s = norm(String(raw ?? ""));
  if (!s) return null;
  if (/longdistance|interstate|^ld$|longhaul|outofstate|crosscountry/.test(s)) return "Long distance";
  if (/commercial|office|business|corporate/.test(s)) return "Commercial";
  if (/storage/.test(s)) return "Storage";
  if (/labor|loadonly|unloadonly|loading|unloading|helper/.test(s)) return "Labor only";
  if (/local|intrastate|residential|instate/.test(s)) return "Local";
  return "Other";
}

export function normStatus(raw: unknown): string | null {
  const s = norm(String(raw ?? ""));
  if (!s) return null;
  if (/complete|done|closed|delivered|finished|paid|won/.test(s)) return "Completed";
  if (/book|schedul|confirm|pending|deposit/.test(s)) return "Booked";
  if (/lost|cancel|declin|noshow|dead/.test(s)) return "Lost";
  return null;
}

export interface ParseResult {
  jobs: Job[];
  rows: number;
  skipped: { row: number; reason: string }[];
  columns: Partial<Record<keyof Job, string>>;
  missingRequired: string[];
  zipMisses: number; // ZIPs we couldn't place in a metro (often rural or outside the 387 metros)
}

export function parseJobsCsv(text: string, zipToCbsa: Record<string, string>): ParseResult {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
  const headers = res.meta.fields || [];
  const columns = matchColumns(headers);
  const missingRequired = TEMPLATE_COLUMNS.filter((c) => c.required && !columns[c.key]).map((c) => c.key);
  const out: ParseResult = { jobs: [], rows: res.data.length, skipped: [], columns, missingRequired, zipMisses: 0 };
  if (!columns.job_date) return out;
  const get = (r: Record<string, string>, k: keyof Job) => (columns[k] ? r[columns[k] as string] : undefined);
  res.data.forEach((r, i) => {
    const rowNum = i + 2; // header is row 1
    const date = parseDate(get(r, "job_date"));
    if (!date) { out.skipped.push({ row: rowNum, reason: "date missing or not readable" }); return; }
    const oz = parseZip(get(r, "origin_zip")), dz = parseZip(get(r, "destination_zip"));
    const oc = oz ? zipToCbsa[oz] ?? null : null, dc = dz ? zipToCbsa[dz] ?? null : null;
    if ((oz && !oc) || (dz && !dc)) out.zipMisses++;
    let type = normType(get(r, "job_type"));
    if (!type && oc && dc) type = oc === dc ? "Local" : "Long distance";
    out.jobs.push({
      job_date: date, origin_zip: oz, destination_zip: dz, origin_cbsa: oc, destination_cbsa: dc,
      job_type: type, status: normStatus(get(r, "status")) ?? (columns.status ? null : "Completed"),
      revenue: parseNumber(get(r, "revenue")), weight_lbs: parseNumber(get(r, "weight_lbs")),
      crew_hours: parseNumber(get(r, "crew_hours")),
      lead_source: (get(r, "lead_source") || "").toString().trim() || null,
    });
  });
  return out;
}

export function jobsToCsv(jobs: Job[]): string {
  const cols: (keyof Job)[] = ["job_date", "origin_zip", "destination_zip", "job_type", "status", "revenue", "weight_lbs", "crew_hours", "lead_source"];
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(","), ...jobs.map((j) => cols.map((c) => esc(j[c])).join(","))].join("\n");
}
