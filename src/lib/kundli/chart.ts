/**
 * Deterministic Vedic (sidereal, Lahiri ayanamsa, whole-sign houses) birth-chart
 * computation. All astronomy comes from the Swiss Ephemeris WASM engine in
 * Moshier mode; everything else here is standard Jyotish arithmetic.
 *
 * This produces the raw *analysis* (positions, dignities, dasha, D-9, doshas)
 * that the Devin playbook then interprets and writes up. The playbook must use
 * these figures verbatim and never recompute them.
 */
import { getEphemeris } from '../ephemeris/engine';
import { geocodeBirthplace } from './geocode';
import {
  localToUt,
  parseBirthDate,
  parseBirthTime,
  type UtcDateTime,
} from './time';

export const SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
] as const;

const NAKSHATRAS = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra',
  'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni',
  'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha',
  'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
] as const;

/** Vimshottari dasha lord order and their period lengths (total 120 years). */
const DASHA_LORDS = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'] as const;
const DASHA_YEARS: Record<string, number> = {
  Ketu: 7, Venus: 20, Sun: 6, Moon: 10, Mars: 7, Rahu: 18, Jupiter: 16, Saturn: 19, Mercury: 17,
};

type PlanetName =
  | 'Sun' | 'Moon' | 'Mars' | 'Mercury' | 'Jupiter' | 'Venus' | 'Saturn' | 'Rahu' | 'Ketu';

/** Exaltation sign index (0 = Aries) and peak degree for the seven grahas. */
const EXALTATION: Partial<Record<PlanetName, { sign: number; degree: number }>> = {
  Sun: { sign: 0, degree: 10 },
  Moon: { sign: 1, degree: 3 },
  Mars: { sign: 9, degree: 28 },
  Mercury: { sign: 5, degree: 15 },
  Jupiter: { sign: 3, degree: 5 },
  Venus: { sign: 11, degree: 27 },
  Saturn: { sign: 6, degree: 20 },
};

const OWN_SIGNS: Partial<Record<PlanetName, number[]>> = {
  Sun: [4], Moon: [3], Mars: [0, 7], Mercury: [2, 5],
  Jupiter: [8, 11], Venus: [1, 6], Saturn: [9, 10],
};

/** Combustion orb in degrees from the Sun. */
const COMBUSTION_ORB: Partial<Record<PlanetName, number>> = {
  Moon: 12, Mars: 17, Mercury: 14, Jupiter: 11, Venus: 10, Saturn: 15,
};

const NAKSHATRA_ARC = 360 / 27; // 13°20'
const PADA_ARC = NAKSHATRA_ARC / 4; // 3°20'
const YEAR_MS = 365.2425 * 24 * 60 * 60 * 1000;

function norm360(x: number): number {
  return ((x % 360) + 360) % 360;
}

export interface PlanetPosition {
  name: PlanetName;
  longitude: number; // sidereal ecliptic longitude, 0-360
  sign: string;
  signIndex: number;
  degreeInSign: number;
  nakshatra: string;
  nakshatraLord: string;
  pada: number;
  house: number; // whole-sign house from Lagna, 1-12
  retrograde: boolean;
  combust: boolean;
  dignity: 'Exalted' | 'Debilitated' | 'Own sign' | 'Neutral';
}

export interface DashaPeriod {
  lord: string;
  start: string; // ISO date
  end: string; // ISO date
}

export interface ChartData {
  input: {
    dateOfBirth: string;
    timeOfBirth: string;
    placeOfBirth: string;
    timezone: string;
  };
  resolved: {
    latitude: number;
    longitude: number;
    matchedPlace: string;
    utc: UtcDateTime;
    julianDayUt: number;
    ayanamsa: number;
  };
  lagna: {
    longitude: number;
    sign: string;
    signIndex: number;
    degreeInSign: number;
    nakshatra: string;
    pada: number;
  };
  moonSign: string;
  sunSign: string;
  planets: PlanetPosition[];
  navamsa: { name: PlanetName; sign: string }[];
  dasha: {
    balanceAtBirthYears: number;
    timeline: DashaPeriod[];
    current: { maha: DashaPeriod; antardasha: DashaPeriod | null } | null;
  };
  doshas: {
    manglik: { present: boolean; from: string[] };
    kaalSarp: { present: boolean; type: string | null };
    sadeSati: { active: boolean; phase: string | null; note: string };
  };
  computedAt: string;
}

function nakshatraOf(longitude: number): { name: string; lord: string; pada: number; index: number } {
  const index = Math.floor(longitude / NAKSHATRA_ARC) % 27;
  const within = longitude - index * NAKSHATRA_ARC;
  const pada = Math.floor(within / PADA_ARC) + 1;
  return { name: NAKSHATRAS[index], lord: DASHA_LORDS[index % 9], pada, index };
}

function dignityOf(name: PlanetName, signIndex: number): PlanetPosition['dignity'] {
  const ex = EXALTATION[name];
  if (ex) {
    if (signIndex === ex.sign) return 'Exalted';
    if (signIndex === (ex.sign + 6) % 12) return 'Debilitated';
  }
  if (OWN_SIGNS[name]?.includes(signIndex)) return 'Own sign';
  return 'Neutral';
}

/** Standard Parashari navamsa: 108 equal arcs of 3°20' counted from Aries. */
function navamsaSign(longitude: number): string {
  const idx = Math.floor(longitude / PADA_ARC) % 12;
  return SIGNS[idx];
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function buildDashaTimeline(
  moonLongitude: number,
  birthMs: number,
): { balanceYears: number; timeline: DashaPeriod[] } {
  const nak = nakshatraOf(moonLongitude);
  const fractionElapsed = (moonLongitude - nak.index * NAKSHATRA_ARC) / NAKSHATRA_ARC;
  const startLordIndex = nak.index % 9;
  const firstLord = DASHA_LORDS[startLordIndex];
  const balanceYears = (1 - fractionElapsed) * DASHA_YEARS[firstLord];

  const timeline: DashaPeriod[] = [];
  let cursor = birthMs;
  // First (partial) mahadasha, then the following full ones.
  for (let i = 0; i < 10; i += 1) {
    const lord = DASHA_LORDS[(startLordIndex + i) % 9];
    const years = i === 0 ? balanceYears : DASHA_YEARS[lord];
    const end = cursor + years * YEAR_MS;
    timeline.push({ lord, start: isoDate(cursor), end: isoDate(end) });
    cursor = end;
  }
  return { balanceYears, timeline };
}

function buildAntardashas(maha: DashaPeriod): DashaPeriod[] {
  const mahaYears = DASHA_YEARS[maha.lord];
  const startMs = Date.parse(maha.start);
  const lordIndex = DASHA_LORDS.indexOf(maha.lord as (typeof DASHA_LORDS)[number]);
  const periods: DashaPeriod[] = [];
  let cursor = startMs;
  for (let i = 0; i < 9; i += 1) {
    const lord = DASHA_LORDS[(lordIndex + i) % 9];
    const years = (mahaYears * DASHA_YEARS[lord]) / 120;
    const end = cursor + years * YEAR_MS;
    periods.push({ lord, start: isoDate(cursor), end: isoDate(end) });
    cursor = end;
  }
  return periods;
}

export interface ComputeChartInput {
  dateOfBirth: string;
  timeOfBirth: string;
  placeOfBirth: string;
  timezone: string;
}

/**
 * Compute the full chart. Throws on unrecoverable input problems (unparseable
 * date/time or an unresolvable birthplace) so the caller can fall back to the
 * playbook computing it itself.
 */
export async function computeChart(input: ComputeChartInput): Promise<ChartData> {
  const date = parseBirthDate(input.dateOfBirth);
  const time = parseBirthTime(input.timeOfBirth);
  if (!date) throw new Error(`Unparseable date of birth: ${input.dateOfBirth}`);
  if (!time) throw new Error(`Unparseable time of birth: ${input.timeOfBirth}`);

  const geo = await geocodeBirthplace(input.placeOfBirth);
  if (!geo) throw new Error(`Could not geocode birthplace: ${input.placeOfBirth}`);

  const utc = localToUt(
    { year: date.year, month: date.month, day: date.day, hour: time.hour, minute: time.minute },
    input.timezone,
  );

  const swe = await getEphemeris();
  swe.set_sid_mode(swe.SE_SIDM_LAHIRI, 0, 0);
  const jd = swe.julday(utc.year, utc.month, utc.day, utc.hour);
  const flags = swe.SEFLG_MOSEPH | swe.SEFLG_SIDEREAL | swe.SEFLG_SPEED;
  const ayanamsa = swe.get_ayanamsa(jd);

  // Ascendant (Lagna) via whole-sign houses.
  const houses = swe.houses_ex(jd, swe.SEFLG_SIDEREAL, geo.latitude, geo.longitude, 'W');
  const ascLongitude = norm360(houses.ascmc[0]);
  const lagnaSignIndex = Math.floor(ascLongitude / 30);
  const lagnaNak = nakshatraOf(ascLongitude);

  const bodyIds: { name: PlanetName; id: number; nodeKetu?: boolean }[] = [
    { name: 'Sun', id: swe.SE_SUN },
    { name: 'Moon', id: swe.SE_MOON },
    { name: 'Mars', id: swe.SE_MARS },
    { name: 'Mercury', id: swe.SE_MERCURY },
    { name: 'Jupiter', id: swe.SE_JUPITER },
    { name: 'Venus', id: swe.SE_VENUS },
    { name: 'Saturn', id: swe.SE_SATURN },
  ];

  const raw: { name: PlanetName; longitude: number; retro: boolean }[] = [];
  let sunLongitude = 0;
  for (const b of bodyIds) {
    const p = swe.calc_ut(jd, b.id, flags);
    const longitude = norm360(p[0]);
    if (b.name === 'Sun') sunLongitude = longitude;
    raw.push({ name: b.name, longitude, retro: p[3] < 0 });
  }
  // Rahu (mean node) and Ketu (opposite); nodes are always retrograde.
  const node = swe.calc_ut(jd, swe.SE_MEAN_NODE, flags);
  const rahuLon = norm360(node[0]);
  raw.push({ name: 'Rahu', longitude: rahuLon, retro: true });
  raw.push({ name: 'Ketu', longitude: norm360(rahuLon + 180), retro: true });

  const planets: PlanetPosition[] = raw.map((r) => {
    const signIndex = Math.floor(r.longitude / 30);
    const nak = nakshatraOf(r.longitude);
    const house = ((signIndex - lagnaSignIndex + 12) % 12) + 1;
    let combust = false;
    const orb = COMBUSTION_ORB[r.name];
    if (orb && r.name !== 'Sun') {
      const sep = Math.abs(((r.longitude - sunLongitude + 540) % 360) - 180);
      combust = sep <= orb;
    }
    return {
      name: r.name,
      longitude: r.longitude,
      sign: SIGNS[signIndex],
      signIndex,
      degreeInSign: r.longitude - signIndex * 30,
      nakshatra: nak.name,
      nakshatraLord: nak.lord,
      pada: nak.pada,
      house,
      retrograde: r.retro,
      combust,
      dignity: dignityOf(r.name, signIndex),
    };
  });

  const bySign = (name: PlanetName): number =>
    planets.find((p) => p.name === name)!.signIndex;
  const moonSignIndex = bySign('Moon');

  // --- Doshas ---
  const marsHouseFrom = (refSignIndex: number): number =>
    ((bySign('Mars') - refSignIndex + 12) % 12) + 1;
  const manglikHouses = new Set([1, 2, 4, 7, 8, 12]);
  const manglikFrom: string[] = [];
  if (manglikHouses.has(marsHouseFrom(lagnaSignIndex))) manglikFrom.push('Lagna');
  if (manglikHouses.has(marsHouseFrom(moonSignIndex))) manglikFrom.push('Moon');
  if (manglikHouses.has(marsHouseFrom(bySign('Venus')))) manglikFrom.push('Venus');

  // Kaal Sarp: are all seven grahas within one Rahu→Ketu semicircle?
  const sevenFromRahu = (['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'] as PlanetName[]).map(
    (n) => norm360(planets.find((p) => p.name === n)!.longitude - rahuLon),
  );
  const allInFirstHalf = sevenFromRahu.every((d) => d > 0 && d < 180);
  const allInSecondHalf = sevenFromRahu.every((d) => d > 180 && d < 360);
  const kaalSarp = { present: allInFirstHalf || allInSecondHalf, type: null as string | null };
  if (kaalSarp.present) {
    const rahuNak = nakshatraOf(rahuLon);
    kaalSarp.type = `Rahu in ${SIGNS[Math.floor(rahuLon / 30)]} (${rahuNak.name})`;
  }

  // Sade Sati: current transit of Saturn relative to natal Moon sign.
  const nowMs = Date.now();
  const nowJd = swe.julday(
    new Date(nowMs).getUTCFullYear(),
    new Date(nowMs).getUTCMonth() + 1,
    new Date(nowMs).getUTCDate(),
    new Date(nowMs).getUTCHours() + new Date(nowMs).getUTCMinutes() / 60,
  );
  const satNow = norm360(swe.calc_ut(nowJd, swe.SE_SATURN, flags)[0]);
  const satNowSign = Math.floor(satNow / 30);
  const relToMoon = (satNowSign - moonSignIndex + 12) % 12;
  let sadeSatiPhase: string | null = null;
  if (relToMoon === 11) sadeSatiPhase = 'Rising (12th from Moon)';
  else if (relToMoon === 0) sadeSatiPhase = 'Peak (over Moon sign)';
  else if (relToMoon === 1) sadeSatiPhase = 'Setting (2nd from Moon)';
  const sadeSati = {
    active: sadeSatiPhase !== null,
    phase: sadeSatiPhase,
    note:
      sadeSatiPhase !== null
        ? `Saturn currently transits ${SIGNS[satNowSign]}, ${['12th', 'Moon', '2nd'][[11, 0, 1].indexOf(relToMoon)]} relative to natal Moon in ${SIGNS[moonSignIndex]}.`
        : `Saturn currently transits ${SIGNS[satNowSign]}; natal Moon in ${SIGNS[moonSignIndex]} — Sade Sati not active.`,
  };

  // --- Dasha ---
  const birthMs = Date.UTC(utc.year, utc.month - 1, utc.day) + utc.hour * 3600 * 1000;
  const moonLongitude = planets.find((p) => p.name === 'Moon')!.longitude;
  const { balanceYears, timeline } = buildDashaTimeline(moonLongitude, birthMs);
  const currentMaha = timeline.find((d) => Date.parse(d.start) <= nowMs && nowMs < Date.parse(d.end)) ?? null;
  let current: ChartData['dasha']['current'] = null;
  if (currentMaha) {
    const antars = buildAntardashas(currentMaha);
    const antardasha = antars.find((a) => Date.parse(a.start) <= nowMs && nowMs < Date.parse(a.end)) ?? null;
    current = { maha: currentMaha, antardasha };
  }

  return {
    input: {
      dateOfBirth: input.dateOfBirth,
      timeOfBirth: input.timeOfBirth,
      placeOfBirth: input.placeOfBirth,
      timezone: input.timezone,
    },
    resolved: {
      latitude: geo.latitude,
      longitude: geo.longitude,
      matchedPlace: geo.matched,
      utc,
      julianDayUt: jd,
      ayanamsa,
    },
    lagna: {
      longitude: ascLongitude,
      sign: SIGNS[lagnaSignIndex],
      signIndex: lagnaSignIndex,
      degreeInSign: ascLongitude - lagnaSignIndex * 30,
      nakshatra: lagnaNak.name,
      pada: lagnaNak.pada,
    },
    moonSign: SIGNS[moonSignIndex],
    sunSign: SIGNS[bySign('Sun')],
    planets,
    navamsa: planets.map((p) => ({ name: p.name, sign: navamsaSign(p.longitude) })),
    dasha: { balanceAtBirthYears: balanceYears, timeline, current },
    doshas: {
      manglik: { present: manglikFrom.length > 0, from: manglikFrom },
      kaalSarp,
      sadeSati,
    },
    computedAt: new Date(nowMs).toISOString(),
  };
}

function deg(x: number): string {
  const d = Math.floor(x);
  const m = Math.round((x - d) * 60);
  return `${d}°${String(m).padStart(2, '0')}'`;
}

/**
 * Render the computed chart as a compact, labelled text block for the playbook
 * prompt. The playbook interprets these exact figures — it must not recompute.
 */
export function chartToPromptText(c: ChartData): string {
  const lines: string[] = [];
  lines.push('PRECOMPUTED VEDIC CHART (sidereal, Lahiri ayanamsa, whole-sign houses).');
  lines.push('These figures are authoritative — use them verbatim; do NOT recompute the ephemeris.');
  lines.push(
    `Birthplace resolved to: ${c.resolved.matchedPlace} (lat ${c.resolved.latitude.toFixed(4)}, lon ${c.resolved.longitude.toFixed(4)}).`,
  );
  lines.push(
    `UT of birth: ${c.resolved.utc.year}-${String(c.resolved.utc.month).padStart(2, '0')}-${String(c.resolved.utc.day).padStart(2, '0')} ${deg(c.resolved.utc.hour).replace('°', 'h').replace("'", 'm')}; ayanamsa ${c.resolved.ayanamsa.toFixed(4)}°.`,
  );
  lines.push(
    `Lagna (Ascendant): ${c.lagna.sign} ${deg(c.lagna.degreeInSign)} — ${c.lagna.nakshatra} pada ${c.lagna.pada}.`,
  );
  lines.push(`Moon sign (Rashi): ${c.moonSign}; Sun sign: ${c.sunSign}.`);
  lines.push('');
  lines.push('Planets (sidereal):');
  for (const p of c.planets) {
    const tags = [
      p.retrograde && p.name !== 'Rahu' && p.name !== 'Ketu' ? 'Retrograde' : '',
      p.combust ? 'Combust' : '',
      p.dignity !== 'Neutral' ? p.dignity : '',
    ].filter(Boolean);
    lines.push(
      `  ${p.name.padEnd(8)} ${p.sign} ${deg(p.degreeInSign)}, House ${p.house}, ${p.nakshatra} (pada ${p.pada}, lord ${p.nakshatraLord})${tags.length ? ' — ' + tags.join(', ') : ''}`,
    );
  }
  lines.push('');
  lines.push('Navamsa (D-9) signs: ' + c.navamsa.map((n) => `${n.name} ${n.sign}`).join('; ') + '.');
  lines.push('');
  lines.push(`Vimshottari dasha (balance at birth: ${c.dasha.balanceAtBirthYears.toFixed(2)} yrs of ${c.dasha.timeline[0].lord}):`);
  if (c.dasha.current) {
    lines.push(
      `  CURRENT Mahadasha: ${c.dasha.current.maha.lord} (${c.dasha.current.maha.start} → ${c.dasha.current.maha.end})` +
        (c.dasha.current.antardasha
          ? `; Antardasha: ${c.dasha.current.antardasha.lord} (${c.dasha.current.antardasha.start} → ${c.dasha.current.antardasha.end})`
          : ''),
    );
  }
  const upcoming = c.dasha.timeline.filter((d) => Date.parse(d.end) > Date.now()).slice(0, 4);
  lines.push('  Mahadasha sequence: ' + upcoming.map((d) => `${d.lord} (${d.start}→${d.end})`).join(', ') + '.');
  lines.push('');
  lines.push('Doshas / yogas detected in THIS chart (only mention what is true here):');
  lines.push(
    `  Manglik (Mangal dosha): ${c.doshas.manglik.present ? 'PRESENT from ' + c.doshas.manglik.from.join(', ') : 'not present'}.`,
  );
  lines.push(
    `  Kaal Sarp: ${c.doshas.kaalSarp.present ? 'PRESENT — ' + c.doshas.kaalSarp.type : 'not present'}.`,
  );
  lines.push(`  Sade Sati: ${c.doshas.sadeSati.active ? 'ACTIVE — ' + c.doshas.sadeSati.phase : 'not active'}. ${c.doshas.sadeSati.note}`);
  return lines.join('\n');
}
