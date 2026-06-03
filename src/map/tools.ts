/**
 * Built-in tool set + SVG icons for the turnkey toolbar (the `toolbar` option /
 * the `sigmet.toolbar` controller). Bring-your-own-UI hosts can ignore this and
 * build their own `ToolbarItem[]`, then hand them to `adapter.addToolbar(...)`.
 */

/** The drawing methods a toolbar button can trigger on a {@link SigmetDraw}. */
export type ToolName =
  | "circle"
  | "tropicalCyclone"
  | "meridian"
  | "parallel"
  | "latBand"
  | "lonBand"
  | "quadrant"
  | "lineSide"
  | "corridor"
  | "wideLine"
  | "polygon"
  | "point"
  | "entireFir";

export interface ToolSpec {
  method: ToolName;
  /** Short button label (used when an engine shows text rather than the icon). */
  label: string;
  /** Tooltip / aria-label. */
  title: string;
}

const wrap = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** Default SVG icons (stroke = `currentColor`) for every tool + the clear action. */
export const TOOL_ICONS: Record<ToolName | "clear", string> = {
  circle: wrap('<circle cx="12" cy="12" r="8"/>'),
  tropicalCyclone: wrap('<path d="M4 5h16M6 9h12M9 13h7M12 17h2"/><path d="M13 17q1 3-1 4"/>'),
  meridian: wrap('<line x1="12" y1="3" x2="12" y2="21"/>'),
  parallel: wrap('<line x1="3" y1="12" x2="21" y2="12"/>'),
  latBand: wrap('<line x1="3" y1="8" x2="21" y2="8"/><line x1="3" y1="16" x2="21" y2="16"/>'),
  lonBand: wrap('<line x1="8" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="16" y2="21"/>'),
  quadrant: wrap('<line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/>'),
  lineSide: wrap('<line x1="4" y1="20" x2="20" y2="4"/>'),
  corridor: wrap('<line x1="3" y1="15" x2="15" y2="3"/><line x1="9" y1="21" x2="21" y2="9"/>'),
  wideLine: wrap(
    '<path d="M9 18.5 L19 10.5 A3.2 3.2 0 0 0 15 5.5 L5 13.5 A3.2 3.2 0 0 0 9 18.5 Z"/>' +
      '<line x1="7" y1="16" x2="17" y2="8" opacity="0.5"/>',
  ),
  polygon: wrap('<polygon points="12,3 21,10 17,21 7,21 3,10"/>'),
  point: wrap('<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>'),
  entireFir: wrap('<rect x="3" y="4" width="18" height="16" rx="4"/>'),
  clear: wrap(
    '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  ),
};

/** Default tool set, in display order (all 12 forms + the tropical-cyclone circle). */
export const DEFAULT_TOOLS: ToolSpec[] = [
  { method: "circle", label: "Circle", title: "Circle — WI nnNM OF PSN (drag centre & radius)" },
  { method: "tropicalCyclone", label: "Cyclone", title: "Tropical cyclone — WI nnnNM OF TC CENTRE (fixed centre, drag radius)" },
  { method: "meridian", label: "Meridian", title: "Meridian half-plane — E OF / W OF a longitude" },
  { method: "parallel", label: "Parallel", title: "Parallel half-plane — N OF / S OF a latitude" },
  { method: "latBand", label: "Lat band", title: "Latitude band — between two parallels" },
  { method: "lonBand", label: "Lon band", title: "Longitude band — between two meridians" },
  { method: "quadrant", label: "Quadrant", title: "Quadrant — combine a parallel & a meridian" },
  { method: "lineSide", label: "Line", title: "Side of a line — N/S/E/W OF LINE (2–4 points)" },
  { method: "corridor", label: "Corridor", title: "Corridor — band between two lines (2–4 points)" },
  { method: "wideLine", label: "Wide line", title: "Wide line — APRX nnKM WID LINE BTN (2–4 points)" },
  { method: "polygon", label: "Polygon", title: "Polygon — WI a closed boundary (drag vertices)" },
  { method: "point", label: "Point", title: "Point — a single position" },
  { method: "entireFir", label: "Entire FIR", title: "Entire FIR — ENTIRE FIR" },
];
