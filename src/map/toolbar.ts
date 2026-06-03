/**
 * Build the SIGMET tool toolbar inside an engine-provided container element
 * (MapLibre `ctrl-group` / OpenLayers `ol-control`). Adds a collapse toggle and
 * active-state handling; styling (orientation, colours) is the host's CSS via the
 * `.sigmet-toolbar` class.
 */
import type { ToolbarItem } from "./adapter.js";

export function populateToolbar(el: HTMLElement, items: ToolbarItem[]): void {
  el.classList.add("sigmet-toolbar");

  const setActive = (btn: HTMLButtonElement) => {
    el.querySelectorAll("button.active").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  };

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = item.title;
    button.setAttribute("aria-label", item.title);
    if (item.svg) button.innerHTML = item.svg;
    else button.textContent = item.label;
    button.addEventListener("click", (e) => {
      e.preventDefault();
      item.onClick();
      if (item.toggle) setActive(button);
      // A non-toggle action (e.g. Clear) deselects the active tool.
      else el.querySelectorAll("button.active").forEach((b) => b.classList.remove("active"));
    });
    el.appendChild(button);
  }
}
