// Acumena branding for the masthead and sign-in screens.
import logo from "./assets/acumena-mark.png";
import { h } from "./lib/dom";

export const BRAND_NAME = "Acumena";
export const BRAND_SUB = "Acumena Analytics";

export function brandBlock() {
  return h("a", { class: "brand", href: "https://acumenasolutions.com", target: "_blank", rel: "noopener", style: "color:inherit;text-decoration:none" },
    h("img", { src: logo, alt: "Acumena lightbulb mark", width: 58, height: 60 }),
    h("span", { class: "brand-text" }, h("span", { class: "brand-name" }, BRAND_NAME), h("span", { class: "brand-sub" }, BRAND_SUB)));
}
