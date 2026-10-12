/**
 * Resolve a free-text birthplace ("City, State, Country") to latitude and
 * longitude, needed for the Ascendant (Lagna) and house cusps.
 *
 * Uses the Open-Meteo geocoding API (no key, no attribution requirement). The
 * timezone used for UT conversion is the one the customer selected on the
 * form — geocoding is only for coordinates.
 */

export interface GeoResult {
  latitude: number;
  longitude: number;
  /** Best-matched place label, for confirmation in the report. */
  matched: string;
}

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

interface OpenMeteoResult {
  name?: string;
  latitude?: number;
  longitude?: number;
  admin1?: string;
  country?: string;
}

async function query(name: string): Promise<GeoResult | null> {
  const url = `${ENDPOINT}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: OpenMeteoResult[] };
  const first = data.results?.[0];
  if (!first || typeof first.latitude !== 'number' || typeof first.longitude !== 'number') {
    return null;
  }
  const label = [first.name, first.admin1, first.country].filter(Boolean).join(', ');
  return { latitude: first.latitude, longitude: first.longitude, matched: label || name };
}

/**
 * Geocode a birthplace. Tries the city (first comma-separated segment) first,
 * then the full string. Returns null if it cannot be resolved.
 */
export async function geocodeBirthplace(placeOfBirth: string): Promise<GeoResult | null> {
  const trimmed = placeOfBirth.trim();
  if (!trimmed) return null;
  const city = trimmed.split(',')[0]?.trim();
  const candidates = [city, trimmed].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    try {
      const result = await query(candidate);
      if (result) return result;
    } catch {
      // try next candidate
    }
  }
  return null;
}
