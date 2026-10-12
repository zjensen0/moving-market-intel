import { describe, expect, it } from "vitest";
import { employersFor, NATIONAL_SEASON, predictOpenings, windowShare } from "../../src/business/hiring_forecast";
import type { Posting } from "../../server/jobs";

const posting = (o: Partial<Posting>): Posting => ({
  id: "indeed:" + Math.random(), source: "indeed", title: "Mover", company: "Bek Moving", company_norm: "bek moving", location: "Arnold, MO",
  cbsa: "41180", role: "mover", pay_min: null, pay_max: null, pay_period: null, pay_hourly_mid: null, job_type: null, url: null, posted_at: null, ...o,
});

describe("windowShare", () => {
  it("looks a month ahead and sums the window", () => {
    const flat = Array(12).fill(1);
    const w = windowShare(flat, 0, 3); // January -> Feb, Mar, Apr
    expect(w.label).toBe("Feb–Apr");
    expect(w.share).toBeCloseTo(0.25, 5);
  });
  it("wraps around the year", () => {
    expect(windowShare(NATIONAL_SEASON, 10, 2).label).toBe("Dec–Jan");
  });
});

describe("predictOpenings", () => {
  const markets = new Map([["41180", { season: NATIONAL_SEASON, growth: 0 }]]);
  const today = new Date("2026-02-15T12:00:00");
  it("gives bigger fleets a higher chance", () => {
    const p = predictOpenings([
      { company: "Big Movers", cbsa: "41180", trucks: 30, drivers: 30, source: "fmcsa" },
      { company: "Tiny Movers", cbsa: "41180", trucks: 1, drivers: 1, source: "fmcsa" },
    ], markets, [], { today });
    const big = p.find((x) => x.company === "Big Movers" && x.role === "driver")!;
    const tiny = p.find((x) => x.company === "Tiny Movers" && x.role === "driver")!;
    expect(big.chance).toBeGreaterThan(tiny.chance);
    expect(big.chance).toBeLessThanOrEqual(1);
    expect(tiny.chance).toBeGreaterThan(0);
  });
  it("rates the spring hiring window above the winter one", () => {
    const e = [{ company: "Mid Movers", cbsa: "41180", trucks: 4, drivers: 4, source: "fmcsa" as const }];
    const spring = predictOpenings(e, markets, [], { today: new Date("2026-03-01T12:00:00") }).find((x) => x.role === "mover")!;
    const winter = predictOpenings(e, markets, [], { today: new Date("2026-10-15T12:00:00") }).find((x) => x.role === "mover")!;
    expect(spring.chance).toBeGreaterThan(winter.chance);
  });
  it("raises the chance when home sales are forecast to grow", () => {
    const e = [{ company: "Mid Movers", cbsa: "41180", trucks: 4, drivers: 4, source: "fmcsa" as const }];
    const up = predictOpenings(e, new Map([["41180", { season: NATIONAL_SEASON, growth: 0.1 }]]), [], { today })[0];
    const down = predictOpenings(e, new Map([["41180", { season: NATIONAL_SEASON, growth: -0.1 }]]), [], { today })[0];
    expect(up.chance).toBeGreaterThan(down.chance);
  });
  it("flags roles the employer is posting now", () => {
    const p = predictOpenings([{ company: "Bek Moving", cbsa: "41180", trucks: 7, drivers: 5, source: "both" }], markets, [posting({ role: "driver" })], { today });
    expect(p.find((x) => x.role === "driver")!.openNow).toBe(true);
    expect(p.find((x) => x.role === "sales")!.openNow).toBe(false);
  });
});

describe("employersFor", () => {
  it("merges FMCSA movers with employers that are posting", () => {
    const top = [["BEK MOVING COMPANY LLC", "Arnold", "MO", 7, 5, 0, 2019, "3237297"], ["Hornet Moving LLC", "St. Louis", "MO", 3, 2, 0, 2016, "1"]];
    const e = employersFor("41180", top, [posting({}), posting({ company: "TK Movers", company_norm: "tk movers" })], new Map());
    expect(e).toHaveLength(3);
    expect(e.find((x) => x.company === "Bek Moving")!.source).toBe("both");
    expect(e.find((x) => x.company === "TK Movers")!.trucks).toBeNull();
  });
});
