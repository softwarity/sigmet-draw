/**
 * Back-compat shim. The map adapter now lives in `@softwarity/draw-adapter` (the
 * shared, generic, data-driven adapter used by every @softwarity drawing lib).
 * This module re-exports the generic types under their historical names and keeps
 * the few SIGMET-specific aliases that the public API still surfaces.
 *
 * The engine adapters (`MapLibreAdapter`, `OpenLayersAdapter`, `LeafletAdapter`)
 * are thin wrappers over the lib that pre-bind the SIGMET manifest — see the
 * `*-adapter.ts` files and `style-features.ts`.
 */
export type {
  MapAdapter,
  PointerEvent,
  SnapshotDelivery,
  SnapshotOptions,
  SnapshotQuality,
  ToolbarItem,
  ToolbarOptions,
  ToolbarPadding,
  ToolbarPosition,
} from "@softwarity/draw-adapter";
export { cursorForHit } from "@softwarity/draw-adapter";

/** The named SIGMET overlays. The FIR is NOT one of them — the host draws it. */
export type OverlayId = "area" | "other" | "guide" | "handles" | "label";

/** Projection is the host map's concern; kept for the web-component wrapper. */
export type Projection = "mercator" | "globe";
