// Tiny DOM helper. Strings always become text nodes (never HTML), so data from files or the
// database can't inject markup.
type Attrs = Record<string, unknown> | null | undefined;
export type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "style") el.setAttribute("style", String(v));
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
      else if (k === "value" && "value" in el) (el as unknown as HTMLInputElement).value = String(v);
      else if (k === "checked" && "checked" in el) (el as unknown as HTMLInputElement).checked = Boolean(v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, kids);
  return el;
}

function append(el: Node, kids: Child[]) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) append(el, kid);
    else el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as T[];
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
