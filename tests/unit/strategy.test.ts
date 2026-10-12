import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pricingCalendar, roundTrips } from "../../src/business/market_strategy";
import { inputMetrics } from "../../src/business/input_metrics";
import { benchPlan } from "../../src/business/radar_insights";

const md = JSON.parse(readFileSync("data/market_data.json", "utf8"));
const clt = md.metros.find((m: any) => m.c === "16740");

describe("roundTrips", () => {
  it("reads both directions of each lane and flags balanced ones", () => {
    const t = roundTrips(clt);
    const raleigh = t.find((x) => x.code === "39580")!;
    expect(raleigh.out).toBe(1789); expect(raleigh.back).toBe(1853);
    expect(raleigh.kind).toBe("both");
    const ny = t.find((x) => x.code === "35620")!;
    expect(ny.kind).toBe("in");          // far more New York -> Charlotte than back
    expect(t[0].kind).toBe("both");      // balanced lanes listed first
  });
});

describe("pricingCalendar", () => {
  it("covers 26 weeks starting on a Monday, with summer busier than winter", () => {
    const cal = pricingCalendar(clt, 52, new Date("2026-01-05T12:00:00"));
    expect(cal).toHaveLength(52);
    expect(cal[0].start.getDay()).toBe(1);
    const avg = (m: number) => { const w = cal.filter((c) => c.start.getMonth() === m); return w.reduce((a, c) => a + c.index, 0) / w.length; };
    expect(avg(5)).toBeGreaterThan(avg(0));
    expect(cal.some((c) => c.why.includes("Month-end rush"))).toBe(true);
  });
});

describe("inputMetrics", () => {
  it("compares the latest three months with the three before", () => {
    const job = (d: string, rev: number, status = "Completed", src = "Google") => ({ job_date: d, origin_zip: null, destination_zip: null, origin_cbsa: null, destination_cbsa: null, job_type: "Local", status, revenue: rev, weight_lbs: null, crew_hours: 4, lead_source: src });
    const jobs = [
      ...Array.from({ length: 12 }, (_, i) => job(`2026-0${7 + (i % 3)}-10`, 1200, i % 4 === 0 ? "Lost" : "Completed", i % 2 ? "Referral" : "Google")),
      ...Array.from({ length: 12 }, (_, i) => job(`2026-0${4 + (i % 3)}-10`, 1000)),
    ];
    const im = inputMetrics(jobs as any, "2026-09");
    const avg = im.metrics.find((m) => m.key === "avg")!;
    expect(avg.now).toBe(1200); expect(avg.prev).toBe(1000);
    expect(im.metrics.find((m) => m.key === "win")!.now).toBeCloseTo(9 / 12);
    expect(im.metrics.find((m) => m.key === "perHour")!.now).toBe(300);
  });
});

describe("benchPlan", () => {
  it("sizes the bench from open and expected openings", () => {
    const preds = [{ company: "A", cbsa: "1", role: "driver" as const, trucks: 5, chance: 0.9, expected: 3.6, openNow: false, band: "High" as const, reasons: [] }];
    const rows = benchPlan(["1"], [], preds, () => null, 0.5, new Date("2026-10-12T12:00:00"));
    expect(rows[0].bench).toBe(2);
  });
});
