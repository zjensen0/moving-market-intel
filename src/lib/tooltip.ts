import { h } from "./dom";

let tip: HTMLElement | null = null;
const el = () => (tip ??= document.getElementById("tip") as HTMLElement);

export function showTip(nodes: Node[], x: number, y: number) {
  const t = el();
  t.replaceChildren(...nodes);
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  t.style.left = Math.max(8, left) + "px";
  t.style.top = Math.max(8, top) + "px";
}
export function hideTip() {
  el().hidden = true;
}
export function tipTitle(text: string) {
  return h("div", { class: "tt-title" }, text);
}
export function tipRow(color: string | null, name: string, value: string, isLine = true) {
  return h("div", { class: "tt-row" },
    color ? h("span", { class: isLine ? "key-line" : "key-dot", style: "background:" + color }) : null,
    h("b", null, value), h("span", { class: "nm" }, name));
}
