/**
 * TAC coordinate codec.
 *
 * ICAO/WMO encode positions as `Nnn[nn] Wnnn[nn]` (WMO-No.49 Vol II, App. 6):
 *   - latitude  : hemisphere N/S + 2-digit degrees + optional 2-digit minutes
 *   - longitude : hemisphere E/W + 3-digit degrees + optional 2-digit minutes
 *
 * Internally we always work in decimal degrees (lon, lat) to stay aligned with
 * GeoJSON, turf and MapLibre. The codec is the single boundary where decimal
 * degrees meet the coded TAC representation.
 */

/** A geographic position in decimal degrees. */
export interface LatLng {
  /** Latitude in decimal degrees, south negative. Range [-90, 90]. */
  lat: number;
  /** Longitude in decimal degrees, west negative. Range [-180, 180]. */
  lon: number;
}

/** Split a signed decimal degree value into whole degrees + rounded minutes. */
function toDegMin(value: number): { deg: number; min: number } {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = Math.round((abs - deg) * 60);
  if (min === 60) {
    deg += 1;
    min = 0;
  }
  return { deg, min };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Encode a latitude (decimal degrees) as `Nnn[nn]` / `Snn[nn]`.
 * @param forceMinutes emit `00` minutes even when whole-degree (some producers
 *   always write the 4-digit form, e.g. `S1500`); default omits zero minutes.
 */
export function formatLat(lat: number, forceMinutes = false): string {
  lat = Math.min(90, Math.max(-90, lat)); // guard against out-of-range input
  const hemi = lat < 0 ? "S" : "N";
  const { deg, min } = toDegMin(lat);
  return `${hemi}${pad(deg, 2)}${min > 0 || forceMinutes ? pad(min, 2) : ""}`;
}

/** Encode a longitude (decimal degrees) as `Wnnn[nn]` / `Ennn[nn]`. */
export function formatLon(lon: number, forceMinutes = false): string {
  // Wrap into [-180, 180) so an "unwrapped" antimeridian frame (e.g. 189°)
  // emits correctly (189 → -171 → W171).
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const hemi = lon < 0 ? "W" : "E";
  const { deg, min } = toDegMin(lon);
  return `${hemi}${pad(deg, 3)}${min > 0 || forceMinutes ? pad(min, 2) : ""}`;
}

/** Encode a position as a TAC coordinate pair, e.g. `N2706 W07306`. */
export function formatLatLng(p: LatLng, forceMinutes = false): string {
  return `${formatLat(p.lat, forceMinutes)} ${formatLon(p.lon, forceMinutes)}`;
}

const LAT_RE = /([NS])(\d{2})(\d{2})?/;
const LON_RE = /([EW])(\d{3})(\d{2})?/;
/** A full coordinate pair, latitude then longitude, separated by whitespace. */
export const LATLNG_RE = new RegExp(
  `${LAT_RE.source}\\s+${LON_RE.source}`,
  "g",
);

/** Parse a single latitude token (`N5430`) to decimal degrees. */
export function parseLat(token: string): number {
  const m = token.match(new RegExp(`^${LAT_RE.source}$`));
  if (!m) throw new Error(`Invalid TAC latitude: "${token}"`);
  const [, hemi, deg, min] = m;
  if (min && Number(min) >= 60) throw new Error(`Invalid TAC latitude minutes: "${token}"`);
  const value = Number(deg) + (min ? Number(min) / 60 : 0);
  if (value > 90) throw new Error(`Latitude out of range: "${token}"`);
  return hemi === "S" ? -value : value;
}

/** Parse a single longitude token (`W07306`) to decimal degrees. */
export function parseLon(token: string): number {
  const m = token.match(new RegExp(`^${LON_RE.source}$`));
  if (!m) throw new Error(`Invalid TAC longitude: "${token}"`);
  const [, hemi, deg, min] = m;
  if (min && Number(min) >= 60) throw new Error(`Invalid TAC longitude minutes: "${token}"`);
  const value = Number(deg) + (min ? Number(min) / 60 : 0);
  if (value > 180) throw new Error(`Longitude out of range: "${token}"`);
  return hemi === "W" ? -value : value;
}

/** Parse a coordinate pair (`N2706 W07306`) to a {@link LatLng}. */
export function parseLatLng(token: string): LatLng {
  const m = token
    .trim()
    .match(new RegExp(`^(${LAT_RE.source})\\s+(${LON_RE.source})$`));
  if (!m) throw new Error(`Invalid TAC coordinate pair: "${token}"`);
  // Reuse the single-token parsers so range/minutes validation is centralised.
  // Groups: m[1] = full lat token, m[5] = full lon token.
  return { lat: parseLat(m[1]!), lon: parseLon(m[5]!) };
}

/** Parse every coordinate pair found in a free string, in order. */
export function parseAllLatLng(text: string): LatLng[] {
  const out: LatLng[] = [];
  for (const m of text.matchAll(LATLNG_RE)) {
    out.push({ lat: parseLat(m[1]! + m[2]! + (m[3] ?? "")), lon: parseLon(m[4]! + m[5]! + (m[6] ?? "")) });
  }
  return out;
}
