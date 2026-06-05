/**
 * Engine-agnostic style spec for the SIGMET drawing overlays. The host configures
 * it once via `new SigmetDraw({ …, style })` (or live with `sigmet.setStyle(…)`);
 * each adapter (MapLibre, OpenLayers) translates these tokens into its own native
 * styling, so the look is identical whatever map engine you graft onto.
 */

/** Filled area: `fill`+`opacity` paint the surface, `stroke`+`width` the outline. */
export interface AreaStyle {
  fill: string;
  stroke: string;
  width: number;
  /** 0–1, applied to the fill. */
  opacity: number;
}

/**
 * Any grab-it-by-a-dot control: vertices and the move / resize / transform /
 * radius handles. They share one look; the smaller move/resize dot and the
 * overlaid glyphs are derived by the adapters. (Collinear — TAC-redundant —
 * vertices are always greyed; that's not configurable.)
 */
export interface IconHandleStyle {
  fill: string;
  stroke: string;
  /** Outline width of the dot. */
  width: number;
  /** Dot radius (px). */
  radius: number;
}

/** Any grab-it-by-a-line control: construction guides, meridian/parallel lines. */
export interface LineHandleStyle {
  stroke: string;
  width: number;
}

/**
 * Dynamic text on the shape (e.g. the live TAC). `width` is the max label width
 * in px — long text wraps onto several lines. The halo thickness is derived from
 * `size` (≈ `ceil(size/10)`), not configurable.
 */
export interface LabelStyle {
  /** Text colour. */
  color: string;
  /** Halo (outline) colour. */
  halo: string;
  /** Font size in px. */
  size: number;
  /** Max label width in px before wrapping. */
  width: number;
}

/** Floating HTML tooltip shown on hover over the geometry. */
export interface TooltipStyle {
  color: string;
  background: string;
  /** Font size in px. */
  size: number;
}

export interface SigmetStyle {
  area: AreaStyle;
  /** Vertices + move/resize/transform/radius handles (dots & glyphs). */
  iconHandle: IconHandleStyle;
  /** The draggable meridian/parallel lines. */
  lineHandle: LineHandleStyle;
  label: LabelStyle;
  tooltip: TooltipStyle;
}

export const DEFAULT_STYLE: SigmetStyle = {
  area: { fill: "#f0883e", stroke: "#f0883e", width: 2, opacity: 0.35 },
  iconHandle: { fill: "#ffffff", stroke: "#58a6ff", width: 2, radius: 7 },
  lineHandle: { stroke: "#58a6ff", width: 4 },
  label: { color: "#ffffff", halo: "#0b1622", size: 13, width: 180 },
  tooltip: { color: "#e6edf3", background: "#0b1622", size: 12 },
};

/** A partial, deeply-optional override of {@link SigmetStyle}. */
export interface SigmetStyleInput {
  area?: Partial<AreaStyle>;
  iconHandle?: Partial<IconHandleStyle>;
  lineHandle?: Partial<LineHandleStyle>;
  label?: Partial<LabelStyle>;
  tooltip?: Partial<TooltipStyle>;
}

/** Merge a partial override onto a resolved base style (one level of nesting). */
export function mergeStyle(base: SigmetStyle, override?: SigmetStyleInput): SigmetStyle {
  if (!override) return base;
  return {
    area: { ...base.area, ...override.area },
    iconHandle: { ...base.iconHandle, ...override.iconHandle },
    lineHandle: { ...base.lineHandle, ...override.lineHandle },
    label: { ...base.label, ...override.label },
    tooltip: { ...base.tooltip, ...override.tooltip },
  };
}

/**
 * Convert a hex colour (`#rgb` or `#rrggbb`) + opacity to an `rgba(…)` string
 * (for OpenLayers, which has no separate fill-opacity). Any other colour form
 * (named, `rgb()`, `rgba()`, `#rrggbbaa`) is returned unchanged — better to drop
 * the opacity than to emit `rgba(NaN, …)`.
 */
export function rgba(color: string, opacity: number): string {
  const c = color.trim();
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  let r: number;
  let g: number;
  let b: number;
  if (m6) {
    r = parseInt(m6[1]!, 16);
    g = parseInt(m6[2]!, 16);
    b = parseInt(m6[3]!, 16);
  } else if (m3) {
    r = parseInt(m3[1]! + m3[1]!, 16);
    g = parseInt(m3[2]! + m3[2]!, 16);
    b = parseInt(m3[3]! + m3[3]!, 16);
  } else {
    return color; // not a parseable hex — pass through (opacity not applied)
  }
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * SVG (as a data URI) for the polygon/circle/buffer **move** handle: a ring of
 * four chevrons pointing outward (N/E/S/W) around the centre dot, signalling
 * "drag to move the whole shape". The centre is left empty so the handle's own
 * dot shows through. `color` themes the chevrons (defaults to the control blue).
 */
export function moveIconDataUri(color = "#58a6ff"): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    `<g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<polyline points="11,9 14,4 17,9"/>` + // up
    `<polyline points="11,19 14,24 17,19"/>` + // down
    `<polyline points="9,11 4,14 9,17"/>` + // left
    `<polyline points="19,11 24,14 19,17"/>` + // right
    `</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * SVG (as a data URI) for a **resize** handle: two radial chevrons — one toward
 * the shape's centre, one to the exterior (the handle is icon-rotated so they
 * align with the centre→handle line). Same chevrons as the transform glyph, but
 * without the rotation arc. `color` themes the strokes.
 */
export function resizeIconDataUri(color = "#58a6ff"): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">` +
    `<g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<polyline points="12,8 15,5 18,8"/>` + // exterior chevron
    `<polyline points="12,22 15,25 18,22"/>` + // centre chevron
    `</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * SVG (as a data URI) for the polygon **transform** handle: two opposite corner
 * brackets (resize) around a curved double-headed arrow (rotate) — the handle
 * scales *and* spins the ring. `color` themes the strokes.
 */
export function transformIconDataUri(color = "#58a6ff"): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">` +
    `<g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    // rotation arc with an arrowhead at each end (do not touch)
    `<path d="M8,16 Q15,8 22,16"/>` +
    `<polyline points="8,12 8,16 12,16"/>` + // left arc head
    `<polyline points="18,16 22,16 22,12"/>` + // right arc head
    // resize chevrons along the radial axis: the icon spins so this maps to the
    // centroid→handle line — top points to the exterior, bottom toward the centre.
    `<polyline points="12,8 15,5 18,8"/>` + // exterior chevron
    `<polyline points="12,22 15,25 18,22"/>` + // centre chevron
    `</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
