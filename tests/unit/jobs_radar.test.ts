import { describe, expect, it } from "vitest";
import { classifyRole, fromAdzuna, fromIndeed, hourlyMid, isRelevant, matchKey, nearestMetro, parsePay } from "../../server/jobs";

describe("hiring radar cleaning", () => {
  it("reads Indeed pay text", () => {
    expect(parsePay("$18 - $22 an hour")).toEqual({ min: 18, max: 22, period: "hour" });
    expect(parsePay("From $21 an hour")).toEqual({ min: 21, max: null, period: "hour" });
    expect(parsePay("Up to $80,000 a year")).toEqual({ min: null, max: 80000, period: "year" });
    expect(parsePay("$0.70 - $0.80 per mile").period).toBe("mile");
    expect(parsePay("N/A").min).toBeNull();
  });
  it("converts pay to an hourly midpoint", () => {
    expect(hourlyMid(650, 800, "week")).toBe(18.13); // rounded to cents
    expect(hourlyMid(41600, 41600, "year")).toBe(20);
    expect(hourlyMid(0.7, 0.8, "mile")).toBeNull();
  });
  it("sorts titles into roles", () => {
    expect(classifyRole("Moving Estimator")).toBe("sales");
    expect(classifyRole("Dispatcher")).toBe("ops");
    expect(classifyRole("CDL-A Household Goods Driver")).toBe("driver");
    expect(classifyRole("Mover / Packer")).toBe("mover");
    expect(classifyRole("Warehouse Associate")).toBe("warehouse");
  });
  it("keeps moving jobs and drops look-alikes", () => {
    expect(isRelevant("Mover / Helper", "Acme")).toBe(true);
    expect(isRelevant("Driver (Non-CDL) / Laborer", "TWO MEN AND A TRUCK")).toBe(true);
    expect(isRelevant("Earth Mover Operator", "Dirt Co")).toBe(false);
    expect(isRelevant("CDL A Driver", "McLane Company")).toBe(false);
    expect(isRelevant("CDL A Driver", "Bob's Transfer", true)).toBe(true);
  });
  it("matches employer names loosely", () => {
    expect(matchKey("Two Men and a Truck - Charlotte")).toBe(matchKey("TWO MEN AND A TRUCK charlotte"));
    expect(matchKey("Sample Moving Co.")).toBe("sample");
  });
  it("places postings in the nearest metro", () => {
    const metros = [{ c: "16740", lat: 35.2, lon: -80.8 }, { c: "39580", lat: 35.8, lon: -78.6 }];
    expect(nearestMetro(35.25, -80.85, metros, "x")).toBe("16740");
    expect(nearestMetro(40, -100, metros, "x")).toBe("x");
    expect(nearestMetro(null, null, metros, "x")).toBe("x");
  });
  it("turns an Adzuna result into a posting, skipping predicted salaries", () => {
    const p = fromAdzuna({ id: "9", title: "<strong>Mover</strong> Crew", company: { display_name: "Acme Moving" }, location: { display_name: "Charlotte, NC" },
      latitude: 35.2, longitude: -80.8, salary_min: 41600, salary_max: 41600, salary_is_predicted: "0", redirect_url: "https://x", created: "2026-10-01T00:00:00Z" },
      "16740", [{ c: "16740", lat: 35.2, lon: -80.8 }], new Set());
    expect(p?.title).toBe("Mover Crew");
    expect(p?.pay_hourly_mid).toBe(20);
    const q = fromAdzuna({ id: "10", title: "Mover", company: { display_name: "Acme Moving" }, salary_min: 50000, salary_is_predicted: "1" }, "16740", [], new Set());
    expect(q?.pay_min).toBeNull();
  });
  it("imports an Indeed sweep file", () => {
    const rows = fromIndeed([{ cbsa: "16740", id: "J1", title: "Mover", company: "X Movers", pay: "$18 - $22 an hour", posted: "September 29, 2026" }]);
    expect(rows[0]).toMatchObject({ id: "indeed:J1", role: "mover", pay_hourly_mid: 20, posted_at: "2026-09-29" });
  });
});
