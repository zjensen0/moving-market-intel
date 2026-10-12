import type { MetroIndexRow, ScoreParts } from "../data/types";
import { load, save } from "../lib/store";

export const COMP: { k: keyof ScoreParts; name: string; help: string }[] = [
  { k: "size", name: "Market size", help: "Household moves per year" },
  { k: "mom", name: "Momentum", help: "Migration and home-sale trends" },
  { k: "room", name: "Room to grow", help: "Household moves per local mover" },
  { k: "val", name: "Customer value", help: "Income of households moving in, and local incomes" },
  { k: "lab", name: "Labor cost", help: "Lower local wages score higher" },
];
export type Weights = Record<keyof ScoreParts, number>;
export const DEFAULT_W: Weights = { size: 25, mom: 25, room: 25, val: 15, lab: 10 };

let W: Weights = { ...DEFAULT_W, ...(load<Partial<Weights>>("mmi.w") || {}) };
let SCORE = new Map<string, number | null>();
let RANK = new Map<string, number>();

export const weights = () => W;
export function setWeight(k: keyof ScoreParts, v: number) {
  W = { ...W, [k]: v };
  save("mmi.w", W);
}
export function resetWeights() {
  W = { ...DEFAULT_W };
  save("mmi.w", W);
}

/** Weighted average of the available parts; a missing part is skipped and the rest rescaled. */
export function scoreOf(sc: ScoreParts, w: Weights = W): number | null {
  let s = 0, t = 0;
  for (const c of COMP) {
    const v = sc[c.k];
    if (v == null || !w[c.k]) continue;
    s += v * w[c.k];
    t += w[c.k];
  }
  return t ? s / t : null;
}

export function rescore(index: MetroIndexRow[]) {
  SCORE = new Map(index.map((m) => [m.c, scoreOf(m.sc)]));
  const order = index.filter((m) => SCORE.get(m.c) != null).sort((a, b) => (SCORE.get(b.c)! - SCORE.get(a.c)!));
  RANK = new Map(order.map((m, i) => [m.c, i + 1]));
}
export const score = (c: string) => SCORE.get(c) ?? null;
export const rank = (c: string) => RANK.get(c) ?? null;
export const rankedCount = () => RANK.size;

export const sizeClass = (m: { pop25: number }) => (m.pop25 >= 1e6 ? "big" : m.pop25 >= 250000 ? "mid" : "small");
export const SIZE_NAMES: Record<string, string> = {
  big: "metros with 1 million or more people",
  mid: "metros with 250,000 to 1 million people",
  small: "metros under 250,000 people",
};
