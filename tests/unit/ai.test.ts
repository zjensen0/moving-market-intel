import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ask, runTool, scoreOf, type AskData, type IndexRow } from "../../server/ai";
import { indexRow, type MetroDetail } from "../../src/data/types";

const market = JSON.parse(readFileSync(new URL("../../data/market_data.json", import.meta.url), "utf8"));
const { metros, ...national } = market as { metros: MetroDetail[] };
const rows = metros.map(indexRow) as unknown as IndexRow[];
const plan = new Set(["16740", "39580"]);
const data: AskData = {
  index: async () => rows,
  snapshot: async (c) => (plan.has(c) ? metros.find((m) => m.c === c) ?? null : null),
  national: async () => national,
  allowed: (c) => plan.has(c),
};

describe("Ask Acumena tools", () => {
  it("ranks metros and respects filters", async () => {
    const r: any = await runTool("search_metros", { state: "TX", size: "big", sort_by: "household_moves_per_year", limit: 3 }, data);
    expect(r.metros).toHaveLength(3);
    expect(r.metros[0].name).toMatch(/TX/);
    expect(r.metros[0].household_moves_per_year).toBeGreaterThanOrEqual(r.metros[1].household_moves_per_year);
  });
  it("gives full detail only for markets in the plan", async () => {
    const yes: any = await runTool("get_market", { metro: "Charlotte" }, data);
    expect(yes.in_plan).toBe(true);
    expect(yes.top_lanes_moving_out.length).toBeGreaterThan(0);
    expect(yes.forecast_90_days.household_moves).toBeGreaterThan(0);
    const no: any = await runTool("get_market", { metro: "New York" }, data);
    expect(no.in_plan).toBe(false);
    expect(no.top_lanes_moving_out).toBeUndefined();
    expect(no.note).toMatch(/not in the company's plan/);
  });
  it("scores with the default weights", () => {
    expect(scoreOf({ size: 100, mom: 0, room: 100, val: 0, lab: 0 })).toBe(50);
  });
  it("runs the tool loop and returns the final text", async () => {
    const calls: any[] = [];
    const replies = [
      { stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: "tool_use", id: "t1", name: "get_market", input: { metro: "16740" } }] },
      { stop_reason: "end_turn", usage: { input_tokens: 300, output_tokens: 50 }, content: [{ type: "text", text: "Charlotte answer" }] },
    ];
    const fakeFetch = async (_url: string, init: any) => { calls.push(JSON.parse(init.body)); const r = replies.shift(); return { ok: true, status: 200, json: async () => r, text: async () => "" }; };
    const out = await ask({ question: "How is Charlotte doing?", orgName: "Sample Moving Co." }, data, "k", "claude-sonnet-5-5", fakeFetch as never);
    expect(out.answer).toBe("Charlotte answer");
    expect(out.tokensIn).toBe(400);
    expect(out.toolCalls).toBe(1);
    const toolResult = calls[1].messages[2].content[0];
    expect(toolResult.type).toBe("tool_result");
    expect(JSON.parse(toolResult.content).name).toBe("Charlotte, NC");
    expect(calls[0].system).toContain("Sample Moving Co.");
  });
});
