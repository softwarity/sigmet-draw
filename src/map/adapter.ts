/**
 * `MapAdapter` — grafts the SIGMET drawing onto an *existing* map (à la Terra
 * Draw). The adapter does NOT create the map: the host owns it (basemap,
 * controls, projection, zoom). The adapter only adds the SIGMET overlays,
 * reports pointer events in lon/lat, and optionally renders a native toolbar.
 *
 * `SigmetDraw` talks only to this; `MapLibreAdapter` / `OpenLayersAdapter` are
 * interchangeable implementations.
 */
import type { FeatureCollection } from "geojson";
import type { LatLng } from "../core/index.js";
import type { SigmetStyle } from "./style.js";

/**
 * The named overlays the drawing renders. Each adapter styles them itself.
 * The FIR is NOT one of them — the host draws its own FIR outline.
 *
 * Feature property convention the adapters rely on:
 *  - `role`   (all guide/handle features) — identifies what a drag targets
 *             (e.g. "center", "radius", "lon", "v0", "a1", "w").
 *  - `control: true`   — a control handle (radius / width); styled distinctly.
 *  - `collinear: true` — a redundant vertex (ignored in the TAC); greyed out.
 *  - `text` (label features) — the dynamic on-shape text to render.
 */
export type OverlayId = "area" | "other" | "guide" | "handles" | "label";

/** Projection is the host map's concern; kept here only for the web-component wrapper. */
export type Projection = "mercator" | "globe";

export interface PointerEvent {
  type: "down" | "move" | "up" | "click";
  lngLat: LatLng;
  hit?: { overlay: OverlayId; props: Record<string, unknown> };
}

/**
 * Where the turnkey toolbar sits over the map. The first token is the anchored
 * edge (which also implies the bar's orientation — top/bottom ⇒ horizontal,
 * left/right ⇒ vertical); a bare edge is centred along it.
 */
export type ToolbarPosition =
  | "top"
  | "top-left"
  | "top-right"
  | "bottom"
  | "bottom-left"
  | "bottom-right"
  | "left"
  | "left-top"
  | "left-bottom"
  | "right"
  | "right-top"
  | "right-bottom";

/** Offset from the map edges: one CSS length for the anchored edge(s), or a
 *  per-side object (e.g. `{ top: "12px", left: "8px" }` for a `top-left` bar). */
export type ToolbarPadding =
  | string
  | { top?: string; right?: string; bottom?: string; left?: string };

/** Layout customisation for the turnkey toolbar. Colours/box come from the host
 *  engine's native control style; these tune placement and flow. */
export interface ToolbarOptions {
  /** Default `"top-left"`. `"top"`/`"bottom"` are horizontally centred. */
  position?: ToolbarPosition;
  /** Button flow. Default `"horizontal"`. */
  orientation?: "horizontal" | "vertical";
  /** Offset from the map edge(s): a CSS length, or per-side. Default `"10px"`. */
  padding?: ToolbarPadding;
  /** Gap between buttons (any CSS length). Default: the engine's native spacing. */
  gap?: string;
  /** Extra class(es) added to the toolbar container for further CSS styling. */
  className?: string;
}

/** A tool button rendered in the host engine's *native* control style. */
export interface ToolbarItem {
  /** Written to the button's `data-tool` attribute. For built-in tools this MUST
   *  be the `ToolName` so the controller can target it (e.g. grey the TC button). */
  id: string;
  title: string;
  /** Short text/glyph fallback shown when no `svg` is given. */
  label: string;
  /** Optional inline SVG markup for the button icon (takes precedence over `label`). */
  svg?: string;
  /** A selectable tool: clicking marks it active (and clears the other toggles). */
  toggle?: boolean;
  onClick: () => void;
}

/**
 * Hover cursor for a hit (shared by both adapters): `move` over a move handle or
 * a draggable guide line (one carrying a `role`), `grab` over any other handle,
 * none elsewhere. Construction guides (no role) are not draggable → no cursor.
 */
export function cursorForHit(hit: PointerEvent["hit"]): string {
  if (hit?.overlay === "handles") return hit.props["move"] ? "move" : "grab";
  if (hit?.overlay === "guide" && hit.props["role"]) return "move";
  return "";
}

export interface MapAdapter {
  /** Resolves once the adapter has attached its overlays to the host map. */
  ready(): Promise<void>;
  setOverlay(id: OverlayId, data: FeatureCollection): void;
  /** Apply a fully-resolved style to the overlays (called by `SigmetDraw`). */
  setStyle(style: SigmetStyle): void;
  /** Show a floating tooltip at `at` (lon/lat), or hide it when `text` is null. */
  setTooltip(text: string | null, at: LatLng): void;
  /** Optional helper: render a tool toolbar as a native map control; returns the
   *  container element (so a controller can mutate it live). */
  addToolbar(items: ToolbarItem[], options?: ToolbarOptions): HTMLElement;
  getCenter(): LatLng;
  setPanEnabled(enabled: boolean): void;
  onPointer(cb: (ev: PointerEvent) => void): void;
  /**
   * Detach everything this adapter added (overlays, pointer listeners, toolbar)
   * and restore the host map. MUST NOT destroy the host map — the host owns its
   * lifecycle (basemap, controls, projection). Safe to call more than once.
   */
  destroy(): void;
}
