import { describe, expect, it } from "vitest";

import { collapseCollinear, collapseRing, perpDist, widthFor } from "../src/map/geometry";

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
