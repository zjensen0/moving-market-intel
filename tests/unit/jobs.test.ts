import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { matchColumns, parseDate, parseJobsCsv, parseNumber, parseZip, normStatus, normType } from "../../src/business/jobs";

const zip: Record<string, string> = { "28202": "16740", "28203": "16740", "28105": "16740", "10025": "35620", "02134": "14460", "30303": "12060" };

describe("cleaning values", () => {
  it("reads dates in several formats", () => {
    expect(parseDate("2026-06-14")).toBe("2026-06-14");
    expect(parseDate("6/14/2026")).toBe("2026-06-14");
    expect(parseDate("6/14/26")).toBe("2026-06-14");
    expect(parseDate("2026-06-14T10:00:00")).toBe("2026-06-14");
    expect(parseDate("46187")).toBe("2026-06-14"); // Excel serial
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("2/30/2026")).toBeNull();
  });
  it("restores ZIP leading zeros and trims ZIP+4", () => {
    expect(parseZip("2134")).toBe("02134");
    expect(parseZip(2134)).toBe("02134");
    expect(parseZip("28202-1234")).toBe("28202");
    expect(parseZip("282021234")).toBe("28202");
    expect(parseZip("")).toBeNull();
  });
  it("reads money", () => {
    expect(parseNumber("$1,215.25")).toBe(1215.25);
    expect(parseNumber("(300)")).toBe(-300);
    expect(parseNumber("")).toBeNull();
  });
  it("normalizes types and statuses", () => {
    expect(normType("Interstate")).toBe("Long distance");
    expect(normType("Residential Local")).toBe("Local");
    expect(normType("Office Move")).toBe("Commercial");
    expect(normStatus("Closed")).toBe("Completed");
    expect(normStatus("Cancelled")).toBe("Lost");
    expect(normStatus("Scheduled")).toBe("Booked");
  });
  it("matches column aliases", () => {
    expect(matchColumns(["Move Date", "From Zip", "To Zip", "Invoice Total"])).toEqual({ job_date: "Move Date", origin_zip: "From Zip", destination_zip: "To Zip", revenue: "Invoice Total" });
  });
});

describe("parseJobsCsv", () => {
  it("parses a realistic export and reports skips", () => {
    const r = parseJobsCsv(readFileSync(new URL("../sample_export.csv", import.meta.url), "utf8"), zip);
    expect(r.rows).toBe(642);
    expect(r.jobs.length).toBe(640);
    expect(r.skipped.map((s) => s.row)).toEqual([7, 11]);
    expect(r.missingRequired).toEqual([]);
    const j = r.jobs.find((x) => x.origin_zip === "28202" && x.destination_zip === "10025");
    if (j) expect(j.destination_cbsa).toBe("35620");
  });
  it("infers job type from metros and defaults status when no column", () => {
    const r = parseJobsCsv("date,origin,destination\n2026-01-05,28202,10025\n2026-01-06,28202,28203\n", zip);
    expect(r.jobs[0].job_type).toBe("Long distance");
    expect(r.jobs[1].job_type).toBe("Local");
    expect(r.jobs[0].status).toBe("Completed");
  });
  it("flags a missing date column", () => {
    const r = parseJobsCsv("origin,destination\n28202,10025\n", zip);
    expect(r.jobs.length).toBe(0);
    expect(r.missingRequired).toContain("job_date");
  });
});
