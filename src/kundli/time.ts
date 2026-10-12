/**
 * Local-birth-time → Universal Time conversion using the birthplace's IANA
 * timezone. Relies on the full IANA/ICU timezone database that the Workers
 * runtime bundles (historical DST/offsets included), so a birth in, say,
 * `Asia/Kolkata` in 1975 or `Europe/London` under wartime DST resolves to the
 * correct UT.
 */

export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
}

export interface UtcDateTime {
  year: number;
  month: number;
  day: number;
  /** Fractional hour in UT (e.g. 5.1667 for 05:10). */
  hour: number;
}

/**
 * The offset (in ms) of `timeZone` at the instant `date`, i.e.
 * localWallClock − UTC. Positive east of Greenwich.
 */
function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUTC - date.getTime();
}

/**
 * Convert a wall-clock local birth time in `timeZone` to UT. Handles DST and
 * historical offset changes; the double-evaluation resolves the ambiguity of
 * offsets that differ between the naive and corrected instants.
 */
export function localToUt(local: LocalDateTime, timeZone: string): UtcDateTime {
  const naiveUtcMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    0,
  );
  let offset = tzOffsetMs(timeZone, new Date(naiveUtcMs));
  let utc = new Date(naiveUtcMs - offset);
  // One refinement pass for offsets that change across the boundary (DST).
  offset = tzOffsetMs(timeZone, utc);
  utc = new Date(naiveUtcMs - offset);

  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    hour:
      utc.getUTCHours() +
      utc.getUTCMinutes() / 60 +
      utc.getUTCSeconds() / 3600,
  };
}

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/**
 * Parse the human birth-date string the form emits ("30 Jan 2000") — with an
 * ISO ("2000-01-30") fallback — into numeric components.
 */
export function parseBirthDate(value: string): { year: number; month: number; day: number } | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }
  const human = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(trimmed);
  if (human) {
    const month = MONTHS.indexOf(human[2].slice(0, 3).toLowerCase()) + 1;
    if (month >= 1) {
      return { year: Number(human[3]), month, day: Number(human[1]) };
    }
  }
  return null;
}

/**
 * Parse the human birth-time string the form emits ("11:30 AM") — with a
 * 24-hour ("23:30") fallback — into hour/minute.
 */
export function parseBirthTime(value: string): { hour: number; minute: number } | null {
  const trimmed = value.trim();
  const ampm = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(trimmed);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    if (/pm/i.test(ampm[3])) hour += 12;
    return { hour, minute: Number(ampm[2]) };
  }
  const h24 = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (h24) {
    return { hour: Number(h24[1]), minute: Number(h24[2]) };
  }
  return null;
}
