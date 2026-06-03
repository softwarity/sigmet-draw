import { describe, expect, it } from "vitest";
import {
  formatLat,
  formatLatLng,
  formatLon,
  parseLat,
  parseLatLng,
  parseLon,
} from "../src/core/index";

describe("coordinate codec", () => {
  it("formats whole degrees without minutes", () => {
    expect(formatLat(54)).toBe("N54");
    expect(formatLat(-50)).toBe("S50");
    expect(formatLon(-12)).toBe("W012");
    expect(formatLon(10)).toBe("E010");
  });

  it("formats minutes when present, zero-padded", () => {
    expect(formatLat(54.5)).toBe("N5430");
    expect(formatLat(27.1)).toBe("N2706");
    expect(formatLon(-73.1)).toBe("W07306");
    expect(formatLon(73.8)).toBe("E07348");
  });

  it("rolls 60 minutes up into a degree", () => {
    // 54 + 59.6' rounds to 55°00'
    expect(formatLat(54.9999)).toBe("N55");
  });

  it("parses latitude and longitude tokens", () => {
    expect(parseLat("N54")).toBe(54);
    expect(parseLat("S1500")).toBe(-15);
    expect(parseLon("W07306")).toBeCloseTo(-73.1, 6);
    expect(parseLon("E07348")).toBeCloseTo(73.8, 6);
  });

  it("parses a coordinate pair", () => {
    expect(parseLatLng("N2706 W07306")).toEqual({
      lat: expect.closeTo(27.1, 6),
      lon: expect.closeTo(-73.1, 6),
    });
  });

  it("round-trips pair → string → pair", () => {
    const s = formatLatLng({ lat: -15.5, lon: 73.8 });
    expect(s).toBe("S1530 E07348");
    expect(parseLatLng(s)).toEqual({
      lat: expect.closeTo(-15.5, 6),
      lon: expect.closeTo(73.8, 6),
    });
  });
});
