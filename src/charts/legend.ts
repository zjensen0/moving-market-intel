import { h } from "../lib/dom";

export function legend(el: HTMLElement, items: { name: string; color: string; dot?: boolean }[]) {
  el.replaceChildren(...items.map((it) =>
    h("span", null, h("span", { class: it.dot ? "key-dot" : "key-line", style: "background:" + it.color }), it.name)));
}
