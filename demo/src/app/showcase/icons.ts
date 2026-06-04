/** Inline SVG icons for the native map toolbar (stroke = currentColor). */
const wrap = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** Filled Material-style icon (fill = currentColor) — for the 2D/3D toggle. */
const wrapFill = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${body}</svg>`;

export const ICONS: Record<string, string> = {
  circle: wrap('<circle cx="12" cy="12" r="8"/>'),
  meridian: wrap('<line x1="12" y1="3" x2="12" y2="21"/>'),
  parallel: wrap('<line x1="3" y1="12" x2="21" y2="12"/>'),
  latBand: wrap('<line x1="3" y1="8" x2="21" y2="8"/><line x1="3" y1="16" x2="21" y2="16"/>'),
  lonBand: wrap('<line x1="8" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="16" y2="21"/>'),
  quadrant: wrap('<line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/>'),
  lineSide: wrap('<line x1="4" y1="20" x2="20" y2="4"/>'),
  corridor: wrap('<line x1="3" y1="15" x2="15" y2="3"/><line x1="9" y1="21" x2="21" y2="9"/>'),
  wideLine: wrap(
    // Buffer outline (a capsule/“bean”) around a centreline — shows the width.
    '<path d="M9 18.5 L19 10.5 A3.2 3.2 0 0 0 15 5.5 L5 13.5 A3.2 3.2 0 0 0 9 18.5 Z"/>' +
      '<line x1="7" y1="16" x2="17" y2="8" opacity="0.5"/>',
  ),
  polygon: wrap('<polygon points="12,3 21,10 17,21 7,21 3,10"/>'),
  point: wrap('<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>'),
  // Tornado / tropical-cyclone funnel: stacked narrowing lines + a tail.
  tropicalCyclone: wrap('<path d="M4 5h16M6 9h12M9 13h7M12 17h2"/><path d="M13 17q1 3-1 4"/>'),
  entireFir: wrap('<rect x="3" y="4" width="18" height="16" rx="4"/>'),
  clear: wrap('<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>'),
  // 2D/3D toggle: Material "earth" globe (3D) ↔ the flat map-in-a-box (2D).
  globe: wrapFill(
    '<path d="M17.9,17.39C17.64,16.59 16.89,16 16,16H15V13A1,1 0 0,0 14,12H8V10H10A1,1 0 0,0 11,9V7H13A2,2 0 0,0 15,5V4.59C17.93,5.77 20,8.64 20,12C20,14.08 19.2,15.97 17.9,17.39M11,19.93C7.05,19.44 4,16.08 4,12C4,11.38 4.08,10.78 4.21,10.21L9,15V16A2,2 0 0,0 11,18M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>',
  ),
  flat: wrapFill(
    '<path d="M5,3C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3H5M15.78,5H19V17.18C18.74,16.38 17.69,15.79 16.8,15.79H15.8V12.79A1,1 0 0,0 14.8,11.79H8.8V9.79H10.8A1,1 0 0,0 11.8,8.79V6.79H13.8C14.83,6.79 15.67,6 15.78,5M5,10.29L9.8,14.79V15.79C9.8,16.9 10.7,17.79 11.8,17.79V19H5V10.29Z"/>',
  ),
};
