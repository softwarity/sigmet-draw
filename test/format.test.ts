import { describe, expect, it } from "vitest";
import { toTAC } from "../src/core/index";
import type { SigmetGeometry } from "../src/core/index";

describe("toTAC", () => {
  it("point", () => {
    expect(toTAC({ kind: "point", position: { lat: 48, lon: 10 } })).toBe(
      "N48 E010",
    );
  });

  it("parallel", () => {
    expect(toTAC({ kind: "parallel", lat: -50, side: "N" })).toBe("N OF S50");
  });

  it("meridian", () => {
    expect(toTAC({ kind: "meridian", lon: -12, side: "E" })).toBe("E OF W012");
  });

  it("quadrant (spec A6-1)", () => {
    const g: SigmetGeometry = {
      kind: "quadrant",
      lat: 54,
      latSide: "S",
      lon: -12,
      lonSide: "E",
    };
    expect(toTAC(g)).toBe("S OF N54 AND E OF W012");
  });

  it("latBand", () => {
    expect(toTAC({ kind: "latBand", north: 54, south: -50 })).toBe(
      "N OF S50 AND S OF N54",
    );
  });

  it("lonBand", () => {
    expect(toTAC({ kind: "lonBand", west: -12, east: 5 })).toBe(
      "E OF W012 AND W OF E005",
    );
  });

  it("lineSide", () => {
    const g: SigmetGeometry = {
      kind: "lineSide",
      side: "SW",
      points: [
        { lat: 54, lon: -12 },
        { lat: 50, lon: -5 },
      ],
    };
    expect(toTAC(g)).toBe("SW OF LINE N54 W012 - N50 W005");
  });

  it("polygon", () => {
    const g: SigmetGeometry = {
      kind: "polygon",
      points: [
        { lat: 48.5, lon: 163.5 },
        { lat: 48.5, lon: 166.5 },
        { lat: 51.5, lon: 163.5 },
      ],
    };
    expect(toTAC(g)).toBe("WI N4830 E16330 - N4830 E16630 - N5130 E16330");
  });

  it("circle (spec A6-2)", () => {
    const g: SigmetGeometry = {
      kind: "circle",
      center: { lat: 27.1, lon: -73.1 },
      radius: 250,
      unit: "NM",
    };
    expect(toTAC(g)).toBe("WI 250NM OF PSN N2706 W07306");
  });

  it("wideLine (spec A6-3): auto omits zero minutes, always pads them", () => {
    const g: SigmetGeometry = {
      kind: "wideLine",
      width: 50,
      unit: "KM",
      points: [
        { lat: -15, lon: 73.8 },
        { lat: -15.5, lon: 76.7 },
      ],
    };
    expect(toTAC(g)).toBe("APRX 50KM WID LINE BTN S15 E07348 - S1530 E07642");
    // The spec example uses the fixed-width form for the whole-degree point.
    expect(toTAC(g, { minutes: "always" })).toBe(
      "APRX 50KM WID LINE BTN S1500 E07348 - S1530 E07642",
    );
  });

  it("entireFir", () => {
    expect(toTAC({ kind: "entireFir" })).toBe("ENTIRE FIR");
    expect(toTAC({ kind: "entireFir", region: "UIR" })).toBe("ENTIRE UIR");
  });
});
