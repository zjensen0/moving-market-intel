// Live lookups in the FMCSA carrier census (public dataset az4n-8mr2 on data.transportation.gov).
// Runs in the browser: the dataset allows cross-site requests and needs no key.
const API = "https://data.transportation.gov/resource/az4n-8mr2.json";

export interface NewMover {
  usdot: string; name: string; legalName: string; city: string; state: string; zip: string; cbsa: string;
  added: string;          // YYYY-MM-DD the carrier registered
  trucks: number; drivers: number; interstate: boolean;
  phone: string | null; email: string | null; officer: string | null;
}
export interface FleetNow { usdot: string; trucks: number; drivers: number; active: boolean }

const ymd = (s: string) => (s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s || "");
const phoneFmt = (p: string | undefined) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p || null;
};
const title = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Llc|Inc|Co)\b/g, (m) => m.toUpperCase());

const MOVER_NAME = /MOV|RELOCAT|VAN LINE|STORAGE|HAULING|JUNK|TWO MEN|PACK/;
/** A registration that ticks household goods is a mover if its name says so or household goods is the only
 *  cargo it hauls. Box-truck freight start-ups tick household goods next to general freight, so those are left out. */
export function looksLikeMover(r: Record<string, string>): boolean {
  if (MOVER_NAME.test(`${r.dba_name || ""} ${r.legal_name || ""}`.toUpperCase())) return true;
  const cargo = Object.keys(r).filter((k) => k.startsWith("crgo_") && r[k] === "X").length;
  return r.crgo_household === "X" && cargo === 1;
}

async function get(params: Record<string, string>): Promise<Record<string, string>[]> {
  const r = await fetch(`${API}?${new URLSearchParams(params)}`);
  if (!r.ok) throw new Error(`FMCSA lookup failed (${r.status})`);
  return r.json();
}

/** Household-goods movers registered in the last `days` days whose business address is in one of `codes`. */
export async function newMovers(states: string[], codes: Set<string>, zipToCbsa: Record<string, string>, days = 365, today = new Date()): Promise<NewMover[]> {
  const since = new Date(today.getTime() - days * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
  const out: NewMover[] = [];
  for (const st of [...new Set(states)].filter((s) => /^[A-Z]{2}$/.test(s))) {
    const rows = await get({ $where: `crgo_household='X' AND status_code='A' AND phy_state='${st}' AND add_date >= '${since}'`, $limit: "5000", $order: "add_date DESC" });
    for (const r of rows) {
      const zip = String(r.phy_zip || "").slice(0, 5);
      const cbsa = zipToCbsa[zip];
      if (!cbsa || !codes.has(cbsa) || !looksLikeMover(r)) continue;
      out.push({
        usdot: r.dot_number, name: title(r.dba_name || r.legal_name || ""), legalName: r.legal_name || "", city: title(r.phy_city || ""), state: r.phy_state, zip, cbsa,
        added: ymd(r.add_date), trucks: Number(r.power_units) || 0, drivers: Number(r.total_drivers) || 0,
        interstate: r.carrier_operation === "A", phone: phoneFmt(r.phone), email: r.email_address ? r.email_address.toLowerCase() : null,
        officer: r.company_officer_1 ? title(r.company_officer_1) : null,
      });
    }
  }
  return out.sort((a, b) => b.added.localeCompare(a.added));
}

/** Current trucks and drivers for a list of USDOT numbers. */
export async function fleetNow(dots: string[]): Promise<Map<string, FleetNow>> {
  const m = new Map<string, FleetNow>();
  const ids = [...new Set(dots.filter((d) => /^\d+$/.test(d)))];
  for (let i = 0; i < ids.length; i += 150) {
    const rows = await get({ $where: `dot_number in (${ids.slice(i, i + 150).map((d) => `'${d}'`).join(",")})`, $select: "dot_number,power_units,total_drivers,status_code", $limit: "1000" });
    for (const r of rows) m.set(r.dot_number, { usdot: r.dot_number, trucks: Number(r.power_units) || 0, drivers: Number(r.total_drivers) || 0, active: r.status_code === "A" });
  }
  return m;
}

export interface FleetChange { usdot: string; name: string; cbsa: string; trucksWas: number; trucksNow: number; driversWas: number; driversNow: number; active: boolean }
/** Compare the movers listed in a market's data (as of the data refresh) with FMCSA today. */
export function fleetChanges(tops: Map<string, unknown[][]>, now: Map<string, FleetNow>): FleetChange[] {
  const out: FleetChange[] = [];
  for (const [cbsa, top] of tops) for (const t of top) {
    const dot = String(t[7] ?? ""), cur = now.get(dot);
    if (!cur) continue;
    const tw = Number(t[3]) || 0, dw = Number(t[4]) || 0;
    if (cur.trucks !== tw || cur.drivers !== dw || !cur.active)
      out.push({ usdot: dot, name: String(t[0]), cbsa, trucksWas: tw, trucksNow: cur.trucks, driversWas: dw, driversNow: cur.drivers, active: cur.active });
  }
  return out.sort((a, b) => (b.trucksNow - b.trucksWas) - (a.trucksNow - a.trucksWas) || (b.driversNow - b.driversWas) - (a.driversNow - a.driversWas));
}
