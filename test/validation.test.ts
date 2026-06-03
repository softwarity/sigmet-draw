import { describe, expect, it } from "vitest";

import { parseLat, parseLon } from "../src/core/coord";
import { fromTAC } from "../src/core/index";

describe("coordinate validation", () => {
  it("parses valid lat/lon (degrees + minutes)", () => {
    expect(parseLat("N2706")).toBeCloseTo(27 + 6 / 60);
    expect(parseLon("W07306")).toBeCloseTo(-(73 + 6 / 60));
  });

  it("rejects minutes >= 60", () => {
    expect(() => parseLat("N2760")).toThrow(/minutes/);
    expect(() => parseLon("E07360")).toThrow(/minutes/);
  });

  it("rejects out-of-range degrees", () => {
    expect(() => parseLat("N9100")).toThrow(/out of range/);
    expect(() => parseLon("E18100")).toThrow(/out of range/);
  });

  it("rejects an out-of-range coordinate via fromTAC", () => {
    expect(() => fromTAC("WI 250NM OF PSN N9100 E04830")).toThrow();
  });
});
