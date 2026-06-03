import { describe, expect, it } from "vitest";
import { fromTAC, toTAC } from "../src/core/index";
import type { SigmetGeometry } from "../src/core/index";

/** Geometries whose coordinates sit on exact minute boundaries round-trip exactly. */
const SAMPLES: SigmetGeometry[] = [
  { kind: "point", position: { lat: 48, lon: 10 } },
  { kind: "parallel", lat: -50, side: "N" },
  { kind: "parallel", lat: 54, side: "S" },
  { kind: "meridian", lon: -12, side: "E" },
  { kind: "meridian", lon: 5, side: "W" },
  { kind: "quadrant", lat: 54, latSide: "S", lon: -12, lonSide: "E" },
  { kind: "latBand", north: 54, south: -50 },
  { kind: "lonBand", west: -12, east: 5 },
  {
    kind: "lineSide",
    side: "NW",
    points: [
      { lat: 54, lon: -12 },
      { lat: 50, lon: -5 },
      { lat: 48.5, lon: -2 },
    ],
  },
  {
    kind: "corridor",
    lineA: {
      side: "N",
      points: [
        { lat: 50, lon: -10 },
        { lat: 52, lon: -4 },
      ],
    },
    lineB: {
      side: "S",
      points: [
        { lat: 54, lon: -10 },
        { lat: 56, lon: -4 },
      ],
    },
  },
  {
    kind: "polygon",
    points: [
      { lat: 48.5, lon: 163.5 },
      { lat: 48.5, lon: 166.5 },
      { lat: 51.5, lon: 163.5 },
    ],
  },
  { kind: "circle", center: { lat: 27.1, lon: -73.1 }, radius: 250, unit: "NM" },
  {
    kind: "wideLine",
    width: 50,
    unit: "KM",
    points: [
      { lat: -15, lon: 73.8 },
      { lat: -15.5, lon: 76.7 },
    ],
  },
  { kind: "entireFir", region: "FIR" },
];

describe("TAC round-trip", () => {
  // The TAC string is the canonical form: parsing then re-emitting must be
  // idempotent. This sidesteps float-equality on degree/minute conversions
  // (e.g. 27 + 6/60 !== literal 27.1) while still proving parse ∘ format agree.
  for (const g of SAMPLES) {
    it(`${g.kind} is stable through TAC → geometry → TAC`, () => {
      const tac = toTAC(g);
      expect(toTAC(fromTAC(tac))).toBe(tac);
    });
  }
});
