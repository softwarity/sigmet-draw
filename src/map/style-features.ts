/**
 * The SIGMET overlay manifest + the **style-in-the-data** bridge to
 * `@softwarity/draw-adapter`. The generic adapter is dumb: it reads render-props
 * off each feature (picked by the layer's `kind`). This module owns the SIGMET
 * manifest and the `decorate()` that bakes the resolved {@link SigmetStyle} into
 * those props — so the adapter never sees a domain type.
 *
 * Replaces what the old per-engine adapters did when they translated
 * `SigmetStyle` directly (≈57 references, gone).
 */
import type { Feature, FeatureCollection } from "geojson";
import type { LayerSpec, TooltipStyle as GenericTooltipStyle } from "@softwarity/draw-adapter";

import type { SigmetStyle, TooltipStyle } from "./style.js";
import { moveIconDataUri, resizeIconDataUri, transformIconDataUri } from "./style.js";

/** The five SIGMET overlays, bottom → top (z-order). */
export const SIGMET_LAYERS: LayerSpec[] = [
  { id: "area", kind: "fill" },
  { id: "other", kind: "fill" }, // invisible clickable flip-side fill
  { id: "guide", kind: "line" },
  { id: "handles", kind: "circle" },
  { id: "label", kind: "text" },
];

/** Overlays a pointer hit may resolve against (handles/guide/area + the flip-side). */
export const SIGMET_HIT = new Set(["handles", "guide", "area", "other"]);

/** Editing-chrome overlays hidden during a snapshot, so the captured image shows
 *  only the drawing (area + label) — not the handles, construction guides, or the
 *  invisible flip-side click zone (`other`, a faint fill that would otherwise show). */
export const SNAPSHOT_HIDE = ["handles", "guide", "other"];

// Internal constants previously hard-coded in the engine adapters.
const OTHER_FILL = "#58a6ff";
const OTHER_OPACITY = 0.08;
const COLLINEAR_GREY = "#8b949e";
/** The move/resize dot is a touch smaller than a vertex (the glyph carries meaning). */
const SMALL_DOT = 0.7;

/** Bearing (deg, compass) of a resize/scale handle → the matching directional
 *  resize cursor, so it aligns with the radial drag axis. No bearing ⇒ `move`. */
function resizeCursor(deg: unknown): string {
  if (typeof deg !== "number" || !Number.isFinite(deg)) return "move";
  const a = ((deg % 180) + 180) % 180; // fold to [0,180)
  if (a < 22.5 || a >= 157.5) return "ns-resize"; // N/S
  if (a < 67.5) return "nesw-resize"; // NE/SW
  if (a < 112.5) return "ew-resize"; // E/W
  return "nwse-resize"; // NW/SE
}

/** Cursor for a draggable guide line, by its `role`. Meridian-like (constant lon)
 *  lines drag east-west; parallel-like (constant lat) lines drag north-south. */
function guideCursor(role: unknown): string {
  if (role === "lon" || role === "west" || role === "east") return "ew-resize";
  if (role === "lat" || role === "north" || role === "south") return "ns-resize";
  return "move"; // a whole-line construction guide (e.g. line-side)
}

/** Map the domain tooltip style to the adapter's generic one (with sane box defaults). */
export function toGenericTooltip(t: TooltipStyle): GenericTooltipStyle {
  return {
    background: t.background,
    color: t.color,
    fontSize: t.size,
    padding: "3px 7px",
    borderRadius: "4px",
    maxWidth: "260px",
  };
}

/**
 * Bake the resolved style into per-feature render-props for overlay `id`. The
 * generic adapter reads only these props (never `SigmetStyle`). Idempotent and
 * pure: returns a new FeatureCollection.
 */
export function decorate(id: string, data: FeatureCollection, s: SigmetStyle): FeatureCollection {
  if (!data.features.length) return data;
  return { type: "FeatureCollection", features: data.features.map((f) => withProps(id, f, s)) };
}

function withProps(id: string, f: Feature, s: SigmetStyle): Feature {
  const p = { ...(f.properties ?? {}) } as Record<string, unknown>;
  switch (id) {
    case "area":
      Object.assign(p, {
        fillColor: s.area.fill,
        fillOpacity: s.area.opacity,
        stroke: s.area.stroke,
        strokeWidth: s.area.width,
      });
      break;
    case "other":
      // Invisible flip-side: a faint fill, no outline (no `stroke` prop).
      Object.assign(p, { fillColor: OTHER_FILL, fillOpacity: OTHER_OPACITY });
      break;
    case "guide":
      Object.assign(p, { stroke: s.lineHandle.stroke, strokeWidth: s.lineHandle.width, cursor: guideCursor(p["role"]) });
      break;
    case "handles": {
      const ih = s.iconHandle;
      if (p["collinear"]) {
        // Redundant (TAC-dropped) vertex: grey, no outline, slightly smaller.
        Object.assign(p, { fill: COLLINEAR_GREY, stroke: COLLINEAR_GREY, strokeWidth: 0, radius: ih.radius * SMALL_DOT, cursor: "grab" });
      } else if (p["move"]) {
        // Smaller dot + outward chevrons glyph (no rotation). Drag = translate shape.
        Object.assign(p, { fill: ih.fill, stroke: ih.stroke, strokeWidth: ih.width, radius: ih.radius * SMALL_DOT, icon: moveIconDataUri(ih.stroke), cursor: "move" });
      } else if (p["transform"]) {
        // Glyph only (no dot): a transparent zero-radius circle keeps the hit area.
        // Scale + rotate ⇒ `move`.
        Object.assign(p, { fill: "rgba(0,0,0,0)", stroke: "rgba(0,0,0,0)", strokeWidth: 0, radius: 0, icon: transformIconDataUri(ih.stroke), cursor: "move" });
      } else if (p["resize"] || p["control"]) {
        // Scale/width/radius handle ⇒ directional resize cursor along its radial axis.
        const dot = p["resize"] ? ih.radius * SMALL_DOT : ih.radius;
        const extra = p["resize"] ? { icon: resizeIconDataUri(ih.stroke) } : {};
        Object.assign(p, { fill: ih.fill, stroke: ih.stroke, strokeWidth: ih.width, radius: dot, cursor: resizeCursor(p["iconRotate"]), ...extra });
      } else {
        // Plain vertex: the full dot.
        Object.assign(p, { fill: ih.fill, stroke: ih.stroke, strokeWidth: ih.width, radius: ih.radius, cursor: "grab" });
      }
      // `iconRotate` (transform/resize) is already on the feature; the adapter reads it.
      break;
    }
    case "label":
      Object.assign(p, {
        text: p["text"],
        textColor: s.label.color,
        textHalo: s.label.halo,
        textSize: s.label.size,
        maxWidth: s.label.width,
      });
      break;
  }
  return { ...f, properties: p };
}
