/**
 * Engine-agnostic style spec for the SIGMET drawing overlays. The host configures
 * it once via `new SigmetDraw({ …, style })` (or live with `sigmet.setStyle(…)`);
 * each adapter (MapLibre, OpenLayers) translates these tokens into its own native
 * styling, so the look is identical whatever map engine you graft onto.
 */

export interface FillStyle {
  color: string;
  /** 0–1. */
  opacity: number;
}

export interface LineStyle {
  color: string;
  width: number;
  /** Dash pattern (alternating on/off lengths). Omit for a solid line. */
  dash?: number[];
}

export interface PointStyle {
  radius: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
}

export interface LabelStyle {
  color: string;
  size: number;
  haloColor: string;
  haloWidth: number;
  /** Vertical offset in pixels (negative lifts the text above the anchor). */
  offsetY: number;
}

export interface SigmetStyle {
  /** The selected zone (intersection with the FIR): fill + outline. */
  area: { fill: FillStyle; line: LineStyle };
  /** Faint preview of the opposite side (line-side / quadrant pick surface). */
  other: { fill: FillStyle };
  /** Construction segments & curves (line/corridor segments, buffer centreline). */
  guide: LineStyle;
  /** A vertex that counts toward the TAC. */
  vertex: PointStyle;
  /** A vertex made redundant by collinearity — ignored in the TAC. */
  collinearVertex: PointStyle;
  /** The radius / width control handle. */
  controlHandle: PointStyle;
  /** Dynamic text shown on the shape (e.g. the live TAC). */
  label: LabelStyle;
}

export const DEFAULT_STYLE: SigmetStyle = {
  area: {
    fill: { color: "#f0883e", opacity: 0.35 },
    line: { color: "#f0883e", width: 2 },
  },
  other: { fill: { color: "#58a6ff", opacity: 0.08 } },
  guide: { color: "#58a6ff", width: 4 },
  vertex: { radius: 7, color: "#ffffff", strokeColor: "#58a6ff", strokeWidth: 2 },
  collinearVertex: { radius: 7, color: "#8b949e", strokeColor: "#8b949e", strokeWidth: 2 },
  controlHandle: { radius: 8, color: "#58a6ff", strokeColor: "#ffffff", strokeWidth: 2 },
  label: { color: "#ffffff", size: 13, haloColor: "#0b1622", haloWidth: 2, offsetY: -14 },
};

/** A partial, deeply-optional override of {@link SigmetStyle}. */
export interface SigmetStyleInput {
  area?: { fill?: Partial<FillStyle>; line?: Partial<LineStyle> };
  other?: { fill?: Partial<FillStyle> };
  guide?: Partial<LineStyle>;
  vertex?: Partial<PointStyle>;
  collinearVertex?: Partial<PointStyle>;
  controlHandle?: Partial<PointStyle>;
  label?: Partial<LabelStyle>;
}

/** Merge a line style, cloning the `dash` array so it isn't shared with the caller. */
function mergeLine(base: LineStyle, over?: Partial<LineStyle>): LineStyle {
  const merged = { ...base, ...over };
  return merged.dash ? { ...merged, dash: [...merged.dash] } : merged;
}

/** Merge a partial override onto a resolved base style (one level of nesting). */
export function mergeStyle(base: SigmetStyle, override?: SigmetStyleInput): SigmetStyle {
  if (!override) return base;
  return {
    area: {
      fill: { ...base.area.fill, ...override.area?.fill },
      line: mergeLine(base.area.line, override.area?.line),
    },
    other: { fill: { ...base.other.fill, ...override.other?.fill } },
    guide: mergeLine(base.guide, override.guide),
    vertex: { ...base.vertex, ...override.vertex },
    collinearVertex: { ...base.collinearVertex, ...override.collinearVertex },
    controlHandle: { ...base.controlHandle, ...override.controlHandle },
    label: { ...base.label, ...override.label },
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
