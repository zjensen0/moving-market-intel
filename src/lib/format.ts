const nf = new Intl.NumberFormat("en-US");
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const fmtInt = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "–" : nf.format(Math.round(v)));
export function fmtCompact(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (a >= 1e4) return Math.round(v / 1e3) + "K";
  if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(v));
}
export const fmtMoney = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "–" : "$" + nf.format(Math.round(v)));
export const fmtMoneyK = (v: number | null | undefined) => (v == null ? "–" : "$" + fmtCompact(v * 1000));
export const fmtMoneyC = (v: number | null | undefined) => (v == null ? "–" : (v < 0 ? "−$" : "$") + fmtCompact(Math.abs(v)));
export const fmtPct = (v: number | null | undefined, d = 0) => (v == null || Number.isNaN(v) ? "–" : (v * 100).toFixed(d) + "%");
export function fmtSignedPct(v: number | null | undefined, d = 1): string {
  if (v == null || Number.isNaN(v)) return "–";
  const x = v * 100;
  const s = Math.abs(x) < 0.05 ? "0" : Math.abs(x).toFixed(d);
  return (x > 0.05 ? "+" : x < -0.05 ? "−" : "") + s + "%";
}
export const fmtSigned = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf.format(Math.abs(Math.round(v)));
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return MONTHS[+m - 1] + " " + y;
};
export const dateLabel = (d: string) => {
  const [y, m, dd] = d.split("-");
  return MONTHS[+m - 1] + " " + +dd + ", " + y;
};
export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
export const sinceLabel = (y: number | null | undefined) => (!y ? "–" : y <= 1974 ? "≤1974" : String(y));
