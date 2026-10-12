import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { addMonths, monthRange, summarize } from "../../src/business/analytics";
import { sampleJobs } from "../../src/business/sample";
import { indexRow, type MetroDetail, type NationalData } from "../../src/data/types";

const market = JSON.parse(readFileSync(new URL("../../data/market_data.json", import.meta.url), "utf8"));
const zip = JSON.parse(readFileSync(new URL("../../data/zip_cbsa.json", import.meta.url), "utf8"));
const { metros, ...N } = market as NationalData & { metros: MetroDetail[] };
const byCode = new Map(metros.map((m) => [m.c, indexRow(m)]));
const home = metros.find((m) => m.c === "16740") as MetroDetail;
const today = new Date(2026, 9, 12);

describe("month helpers", () => {
  it("adds months across years", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2025-11", 3)).toBe("2026-02");
    expect(monthRange("2026-08", 3)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });
});

describe("summarize", () => {
  const jobs = sampleJobs(home, N, zip, "35620");
  const s = summarize(jobs, home, N, byCode, today)!;
  it("counts the latest 12 complete months and leaves lost jobs out", () => {
    expect(s.windowEnd).toBe(N.last_month);
    expect(s.windowStart).toBe(addMonths(N.last_month, -11));
    const inWin = jobs.filter((j) => j.job_date.slice(0, 7) >= s.windowStart && j.job_date.slice(0, 7) <= s.windowEnd && j.status !== "Lost");
    expect(s.jobs12).toBe(inWin.length);
    expect(s.revenue12).toBeCloseTo(inWin.reduce((a, j) => a + (j.revenue || 0), 0), 0);
  });
  it("computes a market share against household moves", () => {
    expect(s.marketShare).toBeGreaterThan(0);
    expect(s.marketShare).toBeLessThan(0.05);
    expect(s.homeJobs12).toBe(s.jobs12); // every sample job touches Charlotte
  });
  it("finds the New York lane untapped because the sample never books it", () => {
    expect(s.untapped?.code).toBe("35620");
    expect(s.untapped?.yourJobs).toBe(0);
  });
  it("builds indexed series averaging 100", () => {
    const idx = s.monthly!.jobsIdx.filter((v): v is number => v != null);
    expect(idx.reduce((a, b) => a + b, 0) / idx.length).toBeCloseTo(100, 6);
    expect(s.price!.yourIdx.find((v) => v != null)).toBeCloseTo(100, 6);
    expect(s.price!.ppiChange).toBeCloseTo(0.132, 2);
  });
  it("handles a handful of jobs without crashing", () => {
    const few = jobs.slice(0, 3);
    const t = summarize(few, home, N, byCode, today)!;
    expect(t.jobs12).toBeGreaterThanOrEqual(0);
    expect(t.monthly).toBeNull();
    expect(t.price).toBeNull();
    expect(summarize([], home, N, byCode, today)).toBeNull();
  });
  it("does not count future bookings in the window", () => {
    const future = [...jobs, { ...jobs[0], id: 99999, job_date: "2026-12-01", status: "Booked" }];
    const t = summarize(future, home, N, byCode, today)!;
    expect(t.windowEnd).toBe("2026-09");
    expect(t.upcoming).toBe(1);
  });
});

describe("booking outlook", () => {
  const jobs = sampleJobs(home, N, zip, "35620");
  const s = summarize(jobs, home, N, byCode, today)!;
  it("forecasts the next three months from last year's same months", () => {
    const o = s.outlook!;
    expect(o.months).toEqual([1, 2, 3].map((k) => addMonths(s.windowEnd, k)));
    o.f.forEach((v, i) => { expect(o.lo[i]).toBeLessThanOrEqual(v); expect(o.hi[i]).toBeGreaterThanOrEqual(v); });
    const ratio = o.f.reduce((a, b) => a + b, 0) / o.ly.reduce((a, b) => a + b, 0);
    expect(ratio).toBeCloseTo(1 + o.g, 1);
  });
  it("needs 15 months of history", () => {
    const short = jobs.filter((j) => j.job_date >= addMonths(s.windowEnd, -9) + "-01");
    expect(summarize(short, home, N, byCode, today)!.outlook).toBeNull();
  });
});
