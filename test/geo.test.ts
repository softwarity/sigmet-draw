import type { Feature, Polygon } from "geojson";
import { describe, expect, it } from "vitest";

import type { SigmetGeometry } from "../src/core/index";
import {
  bearingDeg,
  bboxOf,
  clamp,
  crossesAntimeridian,
  destinationPoint,
  extendLine,
  haversineNM,
  midpoint,
  oppositeSide,
  pointAtFraction,
  pointsBbox,
  pointsSpan,
  projectFraction,
  projectOnSegment,
  snapSide,
  unwrapSigmetGeometry,
  vertexIndex,
} from "../src/map/geo";

describe("vertexIndex", () => {
  it("parses <letter><int> roles", () => {
    expect(vertexIndex("v3")).toBe(3);
    expect(vertexIndex("a0")).toBe(0);
    expect(vertexIndex("b12")).toBe(12);
  });
  it("returns -1 for malformed roles (no silent vertex 0)", () => {
    expect(vertexIndex("")).toBe(-1);
    expect(vertexIndex("v")).toBe(-1);
    expect(vertexIndex("12")).toBe(-1);
    expect(vertexIndex("size")).toBe(-1);
  });
});

describe("clamp", () => {
  it("clamps within [lo, hi]", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("snapSide / oppositeSide", () => {
  it("snaps a direction to the nearest compass side (0=N, 90=E)", () => {
    expect(snapSide(0, 1)).toBe("N");
    expect(snapSide(1, 0)).toBe("E");
    expect(snapSide(0, -1)).toBe("S");
    expect(snapSide(-1, 0)).toBe("W");
    expect(snapSide(1, 1)).toBe("NE");
  });
  it("opposite is 4 steps round the compass", () => {
    expect(oppositeSide("N")).toBe("S");
    expect(oppositeSide("NE")).toBe("SW");
    expect(oppositeSide("E")).toBe("W");
  });
});

describe("haversineNM / bearingDeg / destinationPoint", () => {
  it("1° of latitude ≈ 60 NM", () => {
    expect(haversineNM([0, 0], [0, 1])).toBeCloseTo(60, 0);
  });
  it("destinationPoint round-trips distance and bearing", () => {
    const from = { lat: 45, lon: 5 };
    const [lon, lat] = destinationPoint(from, 100, 30);
    expect(haversineNM([from.lon, from.lat], [lon, lat])).toBeCloseTo(100, 1);
    expect(bearingDeg(from, { lat, lon })).toBeCloseTo(30, 1);
  });
});

describe("pointsBbox / pointsSpan", () => {
  const pts = [
    { lon: 1, lat: 2 },
    { lon: 5, lat: 1 },
    { lon: 3, lat: 6 },
  ];
  it("bounds the points", () => {
    expect(pointsBbox(pts)).toEqual([1, 1, 5, 6]);
  });
  it("span is the largest side", () => {
    expect(pointsSpan(pts)).toBe(5); // height 1..6 = 5 > width 1..5 = 4
  });
});

describe("projectOnSegment", () => {
  it("projects onto the segment (clamped to endpoints)", () => {
    expect(projectOnSegment({ lon: 1, lat: 1 }, [0, 0], [2, 0])).toEqual({ lon: 1, lat: 0 });
    expect(projectOnSegment({ lon: -5, lat: 1 }, [0, 0], [2, 0])).toEqual({ lon: 0, lat: 0 });
    expect(projectOnSegment({ lon: 9, lat: 1 }, [0, 0], [2, 0])).toEqual({ lon: 2, lat: 0 });
  });
});

describe("projectFraction / pointAtFraction", () => {
  const line = [
    { lon: 0, lat: 0 },
    { lon: 10, lat: 0 },
  ];
  it("projects a point to its fraction along the line", () => {
    expect(projectFraction({ lon: 3, lat: 2 }, line).t).toBeCloseTo(0.3, 5);
  });
  it("samples the point at a fraction", () => {
    expect(pointAtFraction(line, 0.5)).toEqual({ lon: 5, lat: 0 });
  });
});

describe("midpoint / extendLine", () => {
  it("midpoint is the mean", () => {
    expect(midpoint([{ lon: 0, lat: 0 }, { lon: 4, lat: 2 }])).toEqual({ lon: 2, lat: 1 });
  });
  it("extendLine prolongs both ends", () => {
    const c = extendLine([{ lon: 0, lat: 0 }, { lon: 10, lat: 0 }], 2);
    expect(c[0]).toEqual([-2, 0]);
    expect(c[c.length - 1]).toEqual([12, 0]);
  });
});

const ring = (coords: [number, number][]): Feature<Polygon> => ({
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [coords] },
});

describe("crossesAntimeridian", () => {
  it("detects the split form (touches both ±180 edges)", () => {
    expect(
      crossesAntimeridian(ring([[179.6, 0], [-179.6, 0], [-179.6, 5], [179.6, 5], [179.6, 0]])),
    ).toBe(true);
  });
  it("is false for a normal FIR", () => {
    expect(crossesAntimeridian(ring([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]))).toBe(false);
  });
});

describe("bboxOf", () => {
  it("bounds a polygon feature", () => {
    expect(bboxOf(ring([[1, 2], [5, 2], [5, 6], [1, 6], [1, 2]]))).toEqual([1, 2, 5, 6]);
  });
});

describe("unwrapSigmetGeometry", () => {
  const uw = (lon: number): number => (lon < 0 ? lon + 360 : lon);
  it("shifts a circle centre into the 0..360 frame", () => {
    const g: SigmetGeometry = { kind: "circle", center: { lat: 2, lon: -175 }, radius: 50, unit: "KM" };
    const out = unwrapSigmetGeometry(g, uw) as Extract<SigmetGeometry, { kind: "circle" }>;
    expect(out.center.lon).toBe(185);
  });
  it("unwraps lonBand bounds and leaves latBand untouched", () => {
    const lb = unwrapSigmetGeometry({ kind: "lonBand", west: -170, east: -179 }, uw) as Extract<
      SigmetGeometry,
      { kind: "lonBand" }
    >;
    expect(lb.west).toBe(190);
    expect(lb.east).toBe(181);
    const lat: SigmetGeometry = { kind: "latBand", south: 10, north: 20 };
    expect(unwrapSigmetGeometry(lat, uw)).toEqual(lat);
  });
  it("is identity under an identity unwrap", () => {
    const g: SigmetGeometry = { kind: "meridian", lon: 5, side: "E" };
    expect(unwrapSigmetGeometry(g, (l) => l)).toEqual(g);
  });
});
