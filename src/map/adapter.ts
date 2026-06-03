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

/** A tool button rendered in the host engine's *native* control style. */
export interface ToolbarItem {
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

export interface MapAdapter {
  /** Resolves once the adapter has attached its overlays to the host map. */
  ready(): Promise<void>;
  setOverlay(id: OverlayId, data: FeatureCollection): void;
  /** Apply a fully-resolved style to the overlays (called by `SigmetDraw`). */
  setStyle(style: SigmetStyle): void;
  /** Optional helper: render a tool toolbar as a native map control. */
  addToolbar(items: ToolbarItem[]): void;
  getCenter(): LatLng;
  setPanEnabled(enabled: boolean): void;
  setCursor(cursor: string): void;
  onPointer(cb: (ev: PointerEvent) => void): void;
  /**
   * Detach everything this adapter added (overlays, pointer listeners, toolbar)
   * and restore the host map. MUST NOT destroy the host map — the host owns its
   * lifecycle (basemap, controls, projection). Safe to call more than once.
   */
  destroy(): void;
}
