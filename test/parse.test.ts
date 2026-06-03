import { describe, expect, it } from "vitest";
import { fromTAC } from "../src/core/index";

describe("fromTAC", () => {
  it("point", () => {
    expect(fromTAC("N48 E010")).toEqual({
      kind: "point",
      position: { lat: 48, lon: 10 },
    });
  });

  it("parallel (spec A6-1 AIRMET: N OF S50)", () => {
    expect(fromTAC("N OF S50")).toEqual({
      kind: "parallel",
      lat: -50,
      side: "N",
    });
  });

  it("meridian", () => {
    expect(fromTAC("E OF W012")).toEqual({
      kind: "meridian",
      lon: -12,
      side: "E",
    });
  });

  it("quadrant (spec A6-1: S OF N54 AND E OF W012)", () => {
    expect(fromTAC("S OF N54 AND E OF W012")).toEqual({
      kind: "quadrant",
      lat: 54,
      latSide: "S",
      lon: -12,
      lonSide: "E",
    });
  });

  it("latBand, order-independent", () => {
    const expected = { kind: "latBand", north: 54, south: -50 };
    expect(fromTAC("N OF S50 AND S OF N54")).toEqual(expected);
    expect(fromTAC("S OF N54 AND N OF S50")).toEqual(expected);
  });

  it("latBand sorts reversed-but-legal bounds (never south > north)", () => {
    // "N OF N54 AND S OF N50" would give south=54, north=50 if taken literally.
    const g = fromTAC("N OF N54 AND S OF N50") as { south: number; north: number };
    expect(g.south).toBe(50);
    expect(g.north).toBe(54);
  });

  it("lonBand", () => {
    expect(fromTAC("E OF W012 AND W OF E005")).toEqual({
      kind: "lonBand",
      west: -12,
      east: 5,
    });
  });

  it("lineSide", () => {
    expect(fromTAC("SW OF LINE N54 W012 - N50 W005")).toEqual({
      kind: "lineSide",
      side: "SW",
      points: [
        { lat: 54, lon: -12 },
        { lat: 50, lon: -5 },
      ],
    });
  });

  it("corridor", () => {
    const g = fromTAC("N OF LINE N50 W010 - N52 W004 AND S OF LINE N54 W010 - N56 W004");
    expect(g.kind).toBe("corridor");
    if (g.kind === "corridor") {
      expect(g.lineA.side).toBe("N");
      expect(g.lineB.side).toBe("S");
      expect(g.lineA.points).toHaveLength(2);
    }
  });

  it("polygon", () => {
    const g = fromTAC("WI N4830 E16330 - N4830 E16630 - N5130 E16330");
    expect(g.kind).toBe("polygon");
    if (g.kind === "polygon") expect(g.points).toHaveLength(3);
  });

  it("circle (spec A6-2)", () => {
    expect(fromTAC("WI 250NM OF PSN N2706 W07306")).toEqual({
      kind: "circle",
      radius: 250,
      unit: "NM",
      center: { lat: expect.closeTo(27.1, 6), lon: expect.closeTo(-73.1, 6) },
    });
  });

  it("circle without PSN keyword", () => {
    const g = fromTAC("WI 50KM OF N2706 W07306");
    expect(g.kind).toBe("circle");
  });

  it("'WI … OF TC CENTRE' parses as a tropical cyclone (not a plain circle)", () => {
    expect(fromTAC("WI 250NM OF TC CENTRE").kind).toBe("tropicalCyclone");
  });

  it("circle with a non-coordinate centre still throws", () => {
    expect(() => fromTAC("WI 250NM OF SOMEWHERE")).toThrow();
  });

  it("wideLine (spec A6-3), tolerant of hyphen and WIDE", () => {
    const g = fromTAC("APRX 50KM WIDE LINE BTN S1500 E07348 – S1530 E07642");
    expect(g).toMatchObject({ kind: "wideLine", width: 50, unit: "KM" });
    if (g.kind === "wideLine") expect(g.points).toHaveLength(2);
  });

  it("entireFir variants", () => {
    expect(fromTAC("ENTIRE FIR")).toEqual({ kind: "entireFir", region: "FIR" });
    expect(fromTAC("ENTIRE FIR/UIR")).toEqual({
      kind: "entireFir",
      region: "FIR/UIR",
    });
  });
});
