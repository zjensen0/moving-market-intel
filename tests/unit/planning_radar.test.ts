import { describe, expect, it } from "vitest";
import { crewPlan, laneOpportunities, priceCheck } from "../../src/business/planning";
import { hardToFill, hiringPressure, payBenchmark } from "../../src/business/radar_insights";
import { looksLikeMover, fleetChanges } from "../../src/data/fmcsa";
import type { BusinessSummary } from "../../src/business/analytics";
import type { Posting } from "../../server/jobs";

const S = (o: Partial<BusinessSummary>): BusinessSummary => ({
  windowStart: "2025-10", windowEnd: "2026-09", firstMonth: "2024-10", lastMonth: "2026-09", upcoming: 0, jobs12: 600, jobsPrior12: 550,
  revenue12: 1_200_000, avgRevenue12: 2000, longShare12: 0.2, longRevShare12: 0.4, winRate: null, homeJobs12: 500, marketShare: 0.01,
  monthly: null, recent: null, price: null, season: null, outlook: null, lanes: [], otherLanes: [], untapped: null, untappedKeys: [], byType: [], bySource: [], ...o,
});
const P = (o: Partial<Posting>): Posting => ({ id: Math.random() + "", source: "indeed", title: "Mover", company: "A Movers", company_norm: "a movers", location: null, cbsa: "1",
  role: "mover", pay_min: null, pay_max: null, pay_period: "hour", pay_hourly_mid: 20, job_type: null, url: null, posted_at: "2026-10-01", ...o });

describe("crewPlan", () => {
  it("turns forecast jobs into crews and flags a shortfall", () => {
    const s = S({ outlook: { months: ["2026-10", "2026-11", "2026-12"], ly: [100, 90, 80], f: [110, 95, 85], lo: [90, 80, 70], hi: [140, 120, 100], g: 0.05, yourTrend: 0.05, marketTrend: 0.05, check: null, checkN: 0 } });
    const plan = crewPlan(s, Array(12).fill(1 / 12), { crews: 4, jobsPerCrewDay: 1, workDays: 22 });
    expect(plan[0].crews).toBe(5);              // 110 / 22 = 5
    expect(plan[0].gap).toBe(1);
    expect(plan.at(-1)!.kind).toBe("peak");
  });
});

describe("priceCheck", () => {
  it("says behind when prices rise slower than the industry", () => {
    const pc = priceCheck(S({ price: { months: [], yourIdx: [], ppiIdx: [], yourAvg: [], ppi: [], yourChange: 0.01, ppiChange: 0.08 } }), { mover: 20, driver: 22, n: 5 }, 21);
    expect(pc.verdict).toBe("behind");
    expect(pc.lines.join(" ")).toContain("$20.00/hr");
  });
});

describe("laneOpportunities", () => {
  it("ranks lanes by jobs added at the usual share", () => {
    const lanes = [
      { code: "a", name: "A, X", dir: "out" as const, households: 1000, miles: 300, yourJobs: 20, share: 0.02 },
      { code: "b", name: "B, X", dir: "in" as const, households: 3000, miles: 500, yourJobs: 0, share: 0 },
      { code: "c", name: "C, X", dir: "in" as const, households: 500, miles: 200, yourJobs: 5, share: 0.01 },
    ];
    const o = laneOpportunities(S({ lanes }), 4000);
    expect(o[0].lane.code).toBe("b");
    expect(o[0].extraRevenue).toBe(o[0].extraJobs * 4000);
  });
});

describe("radar insights", () => {
  it("benchmarks pay and flags hard-to-fill postings", () => {
    const ps = [P({ company: "A Movers", pay_hourly_mid: 16, posted_at: "2026-06-01" }), P({ company: "B Movers", company_norm: "b movers", pay_hourly_mid: 22 }), P({ company: "C Movers", company_norm: "c movers", pay_hourly_mid: 21 })];
    const pb = payBenchmark(ps, ["1"], () => ({ "484210": [1, 10, 800] }));
    expect(pb.rows[0].byRole.mover.median).toBe(21);
    expect(pb.rows[0].blsHourly).toBe(20);
    const hard = hardToFill(ps, new Date("2026-10-12T12:00:00"));
    expect(hard[0].company).toBe("A Movers");
    expect(hard[0].signals.join(" ")).toMatch(/below others/);
  });
  it("ranks hiring pressure per 100 drivers", () => {
    const rows = hiringPressure(["1", "2"], [P({ cbsa: "1" })], [], (c) => ({ fm: { dr: c === "1" ? 10 : 1000 } }));
    expect(rows[0].cbsa).toBe("1");
  });
});

describe("fmcsa helpers", () => {
  it("keeps movers and drops box-truck freight start-ups", () => {
    expect(looksLikeMover({ legal_name: "BEST MOVERS LLC", crgo_household: "X", crgo_genfreight: "X" })).toBe(true);
    expect(looksLikeMover({ legal_name: "JBYRD TRANSPORT LLC", crgo_household: "X" })).toBe(true);
    expect(looksLikeMover({ legal_name: "FAST FREIGHT LLC", crgo_household: "X", crgo_genfreight: "X" })).toBe(false);
  });
  it("reports fleet changes against the data refresh", () => {
    const tops = new Map([["1", [["Big Movers", "X", "NC", 10, 12, 1, 2000, "123"]]]]);
    const ch = fleetChanges(tops, new Map([["123", { usdot: "123", trucks: 14, drivers: 12, active: true }]]));
    expect(ch[0].trucksNow - ch[0].trucksWas).toBe(4);
  });
});

import { summarize } from "../../src/business/analytics";
describe("booking forecast guards", () => {
  it("gives no forecast when a business has too few jobs to read a trend", () => {
    const md = JSON.parse(require("node:fs").readFileSync("data/market_data.json", "utf8"));
    const home = md.metros.find((m: any) => m.c === "16740");
    const byCode = new Map(md.metros.map((m: any) => [m.c, m]));
    const jobs = Array.from({ length: 20 }, (_, i) => ({ job_date: `2025-${String((i % 12) + 1).padStart(2, "0")}-15`, origin_zip: null, destination_zip: null, origin_cbsa: "16740", destination_cbsa: "16740", job_type: "Local", status: "Completed", revenue: 1000, weight_lbs: null, crew_hours: null, lead_source: null }))
      .concat(Array.from({ length: 6 }, (_, i) => ({ job_date: `2026-0${(i % 3) + 7}-10`, origin_zip: null, destination_zip: null, origin_cbsa: "16740", destination_cbsa: "16740", job_type: "Local", status: "Completed", revenue: 1000, weight_lbs: null, crew_hours: null, lead_source: null })));
    const s = summarize(jobs as any, home, md, byCode as any, new Date("2026-10-12T12:00:00"));
    expect(s?.outlook).toBeNull();
  });
});
