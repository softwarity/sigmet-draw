import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, Polygon } from "geojson";
import { describe, expect, it } from "vitest";
import { toArea } from "../src/core/index";
import type { FirInput } from "../src/core/index";

/** A simple rectangular FIR: lon [-20, 10], lat [40, 60]. */
const FIR: FirInput = {
  type: "Polygon",
  coordinates: [
    [
      [-20, 40],
      [10, 40],
      [10, 60],
      [-20, 60],
      [-20, 40],
    ],
  ],
};

const inside = (area: Feature<any>, lon: number, lat: number) =>
  booleanPointInPolygon([lon, lat], area as Feature<Polygon>);

describe("toArea", () => {
  it("point returns a Point feature", () => {
    const a = toArea({ kind: "point", position: { lat: 50, lon: 0 } });
    expect(a.geometry.type).toBe("Point");
  });

  it("unbounded geometry without a FIR throws", () => {
    expect(() => toArea({ kind: "parallel", lat: 50, side: "N" })).toThrow();
  });

  it("parallel N OF 50 clips to the northern half of the FIR", () => {
    const a = toArea({ kind: "parallel", lat: 50, side: "N" }, { fir: FIR });
    expect(a.geometry.type).toMatch(/Polygon/);
    expect(inside(a, 0, 55)).toBe(true); // north of 50 → in
    expect(inside(a, 0, 45)).toBe(false); // south of 50 → out
  });

  it("meridian E OF 0 clips to the eastern half of the FIR", () => {
    const a = toArea({ kind: "meridian", lon: 0, side: "E" }, { fir: FIR });
    expect(inside(a, 5, 50)).toBe(true);
    expect(inside(a, -5, 50)).toBe(false);
  });

  it("latBand keeps only the band", () => {
    const a = toArea(
      { kind: "latBand", north: 55, south: 45 },
      { fir: FIR },
    );
    expect(inside(a, 0, 50)).toBe(true);
    expect(inside(a, 0, 42)).toBe(false);
    expect(inside(a, 0, 58)).toBe(false);
  });

  it("quadrant N&E keeps the NE corner only", () => {
    const a = toArea(
      { kind: "quadrant", lat: 50, latSide: "N", lon: 0, lonSide: "E" },
      { fir: FIR },
    );
    expect(inside(a, 5, 55)).toBe(true); // NE
    expect(inside(a, -5, 55)).toBe(false); // NW
    expect(inside(a, 5, 45)).toBe(false); // SE
  });

  it("lineSide keeps the chosen side of the line", () => {
    // Horizontal-ish line across the FIR at lat ~50; keep north of it.
    const a = toArea(
      {
        kind: "lineSide",
        side: "N",
        points: [
          { lat: 50, lon: -20 },
          { lat: 50, lon: 10 },
        ],
      },
      { fir: FIR },
    );
    expect(inside(a, 0, 55)).toBe(true);
    expect(inside(a, 0, 45)).toBe(false);
  });

  it("circle is a polygon and needs no FIR", () => {
    const a = toArea({
      kind: "circle",
      center: { lat: 50, lon: 0 },
      radius: 100,
      unit: "NM",
    });
    expect(a.geometry.type).toBe("Polygon");
    expect(inside(a, 0, 50)).toBe(true);
  });

  it("wideLine buffers the polyline into a polygon", () => {
    const a = toArea({
      kind: "wideLine",
      width: 50,
      unit: "KM",
      points: [
        { lat: 50, lon: -5 },
        { lat: 50, lon: 5 },
      ],
    });
    expect(a.geometry.type).toMatch(/Polygon/);
    expect(inside(a, 0, 50)).toBe(true); // on the line
    expect(inside(a, 0, 52)).toBe(false); // far off the 25km half-width
  });

  it("entireFir returns the FIR itself", () => {
    const a = toArea({ kind: "entireFir" }, { fir: FIR });
    expect(inside(a, 0, 50)).toBe(true);
    expect(inside(a, 100, 0)).toBe(false);
  });
});
