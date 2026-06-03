/** Inline SVG icons for the native map toolbar (stroke = currentColor). */
const wrap = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

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
  entireFir: wrap('<rect x="3" y="4" width="18" height="16" rx="4"/>'),
  clear: wrap('<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>'),
  globe: wrap('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>'),
  flat: wrap('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 10h18M9 5v14"/>'),
};
