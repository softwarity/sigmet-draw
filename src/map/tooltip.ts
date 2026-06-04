/** Apply a {@link TooltipStyle} to the floating tooltip element (shared by adapters). */
import type { TooltipStyle } from "./style.js";

export function applyTooltipStyle(el: HTMLElement, t: TooltipStyle): void {
  Object.assign(el.style, {
    position: "absolute",
    pointerEvents: "none",
    zIndex: "4",
    transform: "translate(12px, 12px)", // offset from the cursor
    maxWidth: "260px",
    whiteSpace: "normal",
    overflowWrap: "anywhere", // wrap long TAC strings instead of one wide line
    background: t.background,
    color: t.color,
    fontSize: `${t.size}px`,
    lineHeight: "1.35",
    padding: "3px 7px",
    borderRadius: "4px",
  } satisfies Partial<CSSStyleDeclaration>);
}
