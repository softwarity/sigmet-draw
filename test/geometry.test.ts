import { describe, expect, it } from "vitest";

import {
  collapseCollinear,
  collapseRing,
  perpDist,
  radiusFor,
  lineMoveValid,
  lineUsable,
  ringMoveValid,
  segmentDistance,
  segmentsCross,
  widthFor,
} from "../src/map/geometry";

describe("perpDist", () => {
  it("is zero on the line", () => {
    expect(perpDist({ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, { lon: 2, lat: 0 })).toBeCloseTo(0);
  });
  it("measures the perpendicular offset", () => {
    expect(perpDist({ lon: 0, lat: 0 }, { lon: 1, lat: 1 }, { lon: 2, lat: 0 })).toBeCloseTo(1);
  });
});

describe("collapseCollinear", () => {
  it("drops an aligned interior point and flags it", () => {
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 1, lat: 0 },
      { lon: 2, lat: 0 },
    ];
    const r = collapseCollinear(pts, 0.01);
    expect(r.points).toHaveLength(2);
    expect(r.collinear).toEqual([false, true, false]);
  });

  it("keeps a bent interior point", () => {
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 1, lat: 1 },
      { lon: 2, lat: 0 },
    ];
    const r = collapseCollinear(pts, 0.01);
    expect(r.points).toHaveLength(3);
    expect(r.collinear).toEqual([false, false, false]);
  });

  it("never collapses below 2 points", () => {
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 1, lat: 0 },
    ];
    expect(collapseCollinear(pts, 0.01).points).toHaveLength(2);
  });
});

describe("collapseRing", () => {
  it("drops a collinear vertex but keeps >= 3", () => {
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 1, lat: 0 }, // redundant midpoint on the bottom edge
      { lon: 2, lat: 0 },
      { lon: 2, lat: 2 },
      { lon: 0, lat: 2 },
    ];
    const r = collapseRing(pts, 0.01);
    expect(r.points).toHaveLength(4);
    expect(r.collinear[1]).toBe(true);
  });

  it("keeps a triangle intact", () => {
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 2, lat: 0 },
      { lon: 1, lat: 2 },
    ];
    expect(collapseRing(pts, 0.01).points).toHaveLength(3);
  });

  it("keeps a bowing run that departs from the chord (no orphan nodes)", () => {
    // Every triple is locally near-straight, but the arc rises ~1.1 above the
    // chord (lat 0) — far beyond tol. The peak must be kept, not stranded.
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 1, lat: 0.5 },
      { lon: 2, lat: 0.9 },
      { lon: 3, lat: 1.1 }, // peak
      { lon: 4, lat: 0.9 },
      { lon: 5, lat: 0.5 },
      { lon: 6, lat: 0 },
      { lon: 6, lat: -3 },
      { lon: 0, lat: -3 },
    ];
    const r = collapseRing(pts, 0.15);
    expect(r.collinear[3]).toBe(false); // peak survives
    // A truly straight stretch is still simplified (some interior point dropped).
    expect(r.points.length).toBeLessThan(pts.length);
  });

  it("keeps a small spur off the outline (no isolated pair)", () => {
    // Two near-coincident points poke OUT of the top edge — a spur. They depart
    // from the chord by ~0.5 >> tol, so they must be kept, never stranded.
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 2, lat: 0 },
      { lon: 2, lat: 2 },
      { lon: 1.0, lat: 2.5 },
      { lon: 1.0005, lat: 2.5 },
      { lon: 0, lat: 2 },
    ];
    const r = collapseRing(pts, 0.15);
    // The spur survives: at least one of the pair is kept (the other, if dropped,
    // sits right next to its kept twin — not stranded).
    expect(r.collinear[3] === false || r.collinear[4] === false).toBe(true);
    // The kept outline still reaches the spur tip.
    expect(Math.max(...r.points.map((p) => p.lat))).toBeGreaterThan(2.4);
  });

  it("never strands a dropped vertex off the simplified outline", () => {
    // A jagged ring; whatever collapseRing drops must stay within ~tol of the
    // kept outline (the orphan-node guarantee).
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 1, lat: 0.05 },
      { lon: 2, lat: -0.04 },
      { lon: 3, lat: 0.06 },
      { lon: 4, lat: 0 },
      { lon: 4, lat: 4 },
      { lon: 2, lat: 3.9 },
      { lon: 0, lat: 4 },
    ];
    const tol = 0.15;
    const r = collapseRing(pts, tol);
    const dist = (p: { lon: number; lat: number }, a: { lon: number; lat: number }, b: { lon: number; lat: number }) => {
      const dx = b.lon - a.lon;
      const dy = b.lat - a.lat;
      const l2 = dx * dx + dy * dy || 1e-12;
      let t = ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p.lon - (a.lon + t * dx), p.lat - (a.lat + t * dy));
    };
    pts.forEach((p, i) => {
      if (!r.collinear[i]) return;
      let best = Infinity;
      for (let e = 0; e < r.points.length; e++) {
        best = Math.min(best, dist(p, r.points[e]!, r.points[(e + 1) % r.points.length]!));
      }
      expect(best).toBeLessThanOrEqual(tol);
    });
  });
});

describe("segmentsCross", () => {
  it("detects a clean X crossing", () => {
    expect(
      segmentsCross(
        { lon: 0, lat: 0 },
        { lon: 2, lat: 2 },
        { lon: 0, lat: 2 },
        { lon: 2, lat: 0 },
      ),
    ).toBe(true);
  });

  it("returns false for disjoint segments", () => {
    expect(
      segmentsCross(
        { lon: 0, lat: 0 },
        { lon: 1, lat: 0 },
        { lon: 0, lat: 1 },
        { lon: 1, lat: 1 },
      ),
    ).toBe(false);
  });

  it("treats a shared endpoint as not crossing", () => {
    expect(
      segmentsCross(
        { lon: 0, lat: 0 },
        { lon: 1, lat: 1 },
        { lon: 1, lat: 1 },
        { lon: 2, lat: 0 },
      ),
    ).toBe(false);
  });
});

describe("segmentDistance", () => {
  it("is 0 for crossing segments", () => {
    expect(
      segmentDistance(
        { lon: 0, lat: 0 },
        { lon: 2, lat: 2 },
        { lon: 0, lat: 2 },
        { lon: 2, lat: 0 },
      ),
    ).toBe(0);
  });

  it("measures the gap between parallel segments", () => {
    expect(
      segmentDistance(
        { lon: 0, lat: 0 },
        { lon: 2, lat: 0 },
        { lon: 0, lat: 1 },
        { lon: 2, lat: 1 },
      ),
    ).toBeCloseTo(1);
  });

  it("measures a near touch (point close to a segment)", () => {
    expect(
      segmentDistance(
        { lon: 1, lat: 0.1 },
        { lon: 1, lat: 3 },
        { lon: 0, lat: 0 },
        { lon: 2, lat: 0 },
      ),
    ).toBeCloseTo(0.1);
  });
});

describe("ringMoveValid", () => {
  // Unit square, CCW.
  const square = (): { lon: number; lat: number }[] => [
    { lon: 0, lat: 0 },
    { lon: 2, lat: 0 },
    { lon: 2, lat: 2 },
    { lon: 0, lat: 2 },
  ];

  it("allows a normal nudge", () => {
    expect(ringMoveValid(square(), 2, { lon: 2.5, lat: 2.5 }, 0.01, 0.01)).toBe(true);
  });

  it("rejects merging a vertex onto a neighbour", () => {
    // Move v2 onto v1 (2,0).
    expect(ringMoveValid(square(), 2, { lon: 2, lat: 0.001 }, 0.05, 0.05)).toBe(false);
  });

  it("rejects merely approaching another vertex within the vertex buffer", () => {
    expect(ringMoveValid(square(), 2, { lon: 2, lat: 0.04 }, 0.05, 0.005)).toBe(false);
    expect(ringMoveValid(square(), 2, { lon: 2, lat: 0.2 }, 0.05, 0.005)).toBe(true);
  });

  it("rejects a move that self-crosses the ring (bow-tie)", () => {
    // Drag v2 across the square so edges fold into an X.
    expect(ringMoveValid(square(), 2, { lon: -1, lat: 1 }, 0.01, 0.01)).toBe(false);
  });

  it("rejects parking a vertex on a non-adjacent edge", () => {
    // Drag v2 onto the bottom edge v0–v1 (y = 0) without crossing it.
    expect(ringMoveValid(square(), 2, { lon: 1, lat: 0.02 }, 0.005, 0.05)).toBe(false);
  });

  it("rejects approaching a non-adjacent edge within the edge buffer", () => {
    // Just shy of the bottom edge, still inside the edge clearance buffer.
    expect(ringMoveValid(square(), 2, { lon: 1, lat: 0.03 }, 0.005, 0.05)).toBe(false);
    // Clear of the buffer → allowed.
    expect(ringMoveValid(square(), 2, { lon: 1, lat: 0.2 }, 0.005, 0.05)).toBe(true);
  });

  it("rejects a move whose edge sweeps over another vertex", () => {
    // Pentagon; v3 = (2,1) lies exactly on the line from v0'=(0,2) to v1=(4,0).
    // Dragging v0 to (0,2) makes edge v0–v1 pass through vertex v3.
    const penta = [
      { lon: 0, lat: 0 }, // v0 (dragged)
      { lon: 4, lat: 0 }, // v1
      { lon: 4, lat: 4 }, // v2
      { lon: 2, lat: 1 }, // v3 — on the swept edge
      { lon: 0, lat: 4 }, // v4
    ];
    expect(ringMoveValid(penta, 0, { lon: 0, lat: 2 }, 0.005, 0.05)).toBe(false);
  });

  it("never blocks a triangle (n < 4 has no non-adjacent edge)", () => {
    const tri = [
      { lon: 0, lat: 0 },
      { lon: 2, lat: 0 },
      { lon: 1, lat: 2 },
    ];
    expect(ringMoveValid(tri, 2, { lon: 1, lat: -5 }, 0.01, 0.01)).toBe(true);
  });
});

describe("lineUsable", () => {
  it("accepts a normal spread polyline", () => {
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 3, lat: 1 },
      { lon: 6, lat: 0 },
    ];
    expect(lineUsable(pts, 0.5)).toBe(true);
  });

  it("rejects collapsed endpoints (both snapped to the same border point)", () => {
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 3, lat: 2 },
      { lon: 0.01, lat: 0.01 },
    ];
    expect(lineUsable(pts, 0.5)).toBe(false);
  });

  it("rejects a self-crossing (folded) polyline", () => {
    // 4 points where edge 0–1 crosses edge 2–3.
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 4, lat: 4 },
      { lon: 4, lat: 0 },
      { lon: 0, lat: 4 },
    ];
    expect(lineUsable(pts, 0.5)).toBe(false);
  });

  it("rejects a <2-point line", () => {
    expect(lineUsable([{ lon: 0, lat: 0 }], 0.5)).toBe(false);
  });
});

describe("lineMoveValid (open polyline)", () => {
  // A 4-point open zig-zag.
  const line = (): { lon: number; lat: number }[] => [
    { lon: 0, lat: 0 },
    { lon: 2, lat: 2 },
    { lon: 4, lat: 0 },
    { lon: 6, lat: 2 },
  ];

  it("allows a normal nudge", () => {
    expect(lineMoveValid(line(), 1, { lon: 2, lat: 3 }, 0.01, 0.01)).toBe(true);
  });

  it("rejects merging an interior point onto a neighbour", () => {
    expect(lineMoveValid(line(), 1, { lon: 0, lat: 0.001 }, 0.05, 0.005)).toBe(false);
  });

  it("rejects a self-crossing move", () => {
    // Drag endpoint v0 to (8,0): edge v0–v1 then crosses edge v2–v3 at ~(5,1).
    expect(lineMoveValid(line(), 0, { lon: 8, lat: 0 }, 0.005, 0.01)).toBe(false);
  });

  it("rejects an endpoint move that sweeps its edge over another vertex", () => {
    // Move endpoint v3 to (0,4): edge v2(4,0)–v3' passes through v1 (2,2).
    expect(lineMoveValid(line(), 3, { lon: 0, lat: 4 }, 0.005, 0.05)).toBe(false);
  });

  it("a 2-point line only guards against merging the endpoints", () => {
    const seg = [
      { lon: 0, lat: 0 },
      { lon: 4, lat: 0 },
    ];
    expect(lineMoveValid(seg, 1, { lon: 0, lat: 0.001 }, 0.05, 0.01)).toBe(false);
    expect(lineMoveValid(seg, 1, { lon: 2, lat: 5 }, 0.05, 0.01)).toBe(true);
  });
});

describe("widthFor", () => {
  const halfFor = (fullKM: number) => fullKM / (2 * 1.852);

  it("stays in KM up to 99", () => {
    expect(widthFor(halfFor(50))).toEqual({ unit: "KM", width: 50 });
  });

  it("keeps KM at exactly 99 KM", () => {
    expect(widthFor(halfFor(99))).toEqual({ unit: "KM", width: 99 });
  });

  it("switches to NM beyond 99 KM", () => {
    const r = widthFor(halfFor(120));
    expect(r.unit).toBe("NM");
    expect(r.width).toBe(Math.round(120 / 1.852));
  });

  it("caps at 99 NM", () => {
    expect(widthFor(1000)).toEqual({ unit: "NM", width: 99 });
  });

  it("floors KM at 1", () => {
    expect(widthFor(0.0001)).toEqual({ unit: "KM", width: 1 });
  });
});

describe("radiusFor", () => {
  it("circle (cap 99): KM up to 99, then NM capped at 99", () => {
    expect(radiusFor(20, 99)).toEqual({ unit: "KM", value: Math.round(20 * 1.852) });
    expect(radiusFor(70, 99)).toEqual({ unit: "NM", value: 70 }); // 130 km > 99
    expect(radiusFor(500, 99)).toEqual({ unit: "NM", value: 99 }); // capped
  });

  it("tropical cyclone (cap 999): KM up to 999, then NM capped at 999", () => {
    expect(radiusFor(200, 999)).toEqual({ unit: "KM", value: Math.round(200 * 1.852) });
    expect(radiusFor(600, 999)).toEqual({ unit: "NM", value: 600 }); // 1111 km > 999
    expect(radiusFor(5000, 999)).toEqual({ unit: "NM", value: 999 }); // capped
  });

  it("nmOnly forces NM (never KM)", () => {
    expect(radiusFor(20, 99, true)).toEqual({ unit: "NM", value: 20 });
    expect(radiusFor(0.2, 99, true)).toEqual({ unit: "NM", value: 1 }); // floored
    expect(radiusFor(2000, 999, true)).toEqual({ unit: "NM", value: 999 });
    expect(widthFor(10, true)).toEqual({ unit: "NM", width: 20 });
    expect(widthFor(0.1, true)).toEqual({ unit: "NM", width: 1 });
  });
});
