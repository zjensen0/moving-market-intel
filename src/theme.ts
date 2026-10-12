// Light / dark / auto. Stored per browser; "auto" follows the device setting.
import { h } from "./lib/dom";
import { load, save } from "./lib/store";

export type Theme = "auto" | "light" | "dark";
const KEY = "mmi.theme";

export const currentTheme = (): Theme => load<Theme>(KEY) || "auto";

export function applyTheme(t: Theme = currentTheme()) {
  const root = document.documentElement;
  if (t === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
}

export function setTheme(t: Theme) {
  save(KEY, t);
  applyTheme(t);
  document.dispatchEvent(new Event("mmi:redraw"));
}

/** Small three-way switch for the top bar. */
export function themeSwitch() {
  const opts: [Theme, string, string][] = [["auto", "Auto", "Follow the device setting"], ["light", "Light", "Light mode"], ["dark", "Dark", "Dark mode"]];
  const seg = h("div", { class: "seg seg-theme", role: "group", "aria-label": "Color theme" });
  const draw = () => seg.replaceChildren(...opts.map(([v, label, title]) =>
    h("button", { type: "button", "aria-pressed": String(currentTheme() === v), title, onclick: () => { setTheme(v); draw(); } }, label)));
  draw();
  return seg;
}
