// dates.js – Datumslogik, fest auf Europe/Berlin (unabhängig von der Geräte-Zeitzone).
// Grundprinzip: Tage werden als Kalenderschlüssel "YYYY-MM-DD" gespeichert,
// Zeitpunkte als epoch-ms. Kalenderrechnung (Tage addieren, Wochentag) läuft rein
// über UTC-Datumsarithmetik auf dem Schlüssel und ist damit sommerzeitfest.

export const TZ = 'Europe/Berlin';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Wanduhr-Bestandteile in Berlin für einen Zeitstempel. */
export function berlinParts(ts = Date.now()) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(ts))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second };
}

const pad = (n) => String(n).padStart(2, '0');
export const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

export function isValidKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const { y, m, d } = parseKey(key);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(key, n) {
  const { y, m, d } = parseKey(key);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Tage von a nach b (b − a). */
export function diffDays(a, b) {
  const A = parseKey(a), B = parseKey(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 864e5);
}

/** Wochentag 0 = Montag … 6 = Sonntag. */
export function weekday(key) {
  const { y, m, d } = parseKey(key);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
export const weekStart = (key) => addDays(key, -weekday(key));

/** ISO-Kalenderwoche. */
export function isoWeek(key) {
  const thursday = addDays(key, 3 - weekday(key));
  const { y } = parseKey(thursday);
  return 1 + Math.floor(diffDays(keyOf(y, 1, 1), thursday) / 7);
}

/** Kalenderdatum (Berlin) eines Zeitstempels. */
export function calendarKey(ts = Date.now()) {
  const p = berlinParts(ts);
  return keyOf(p.y, p.m, p.d);
}

/** Logischer Tag: vor `dayStartHour` Uhr zählt noch zum Vortag. */
export function logicalKey(ts = Date.now(), dayStartHour = 4) {
  const p = berlinParts(ts);
  const k = keyOf(p.y, p.m, p.d);
  return p.hh < dayStartHour ? addDays(k, -1) : k;
}

/** Berliner Wanduhrzeit (Kalendertag + hh:mm) → epoch-ms. Bei DST-Lücken wird vorgerückt. */
export function wallToTs(key, hh, mm) {
  const { y, m, d } = parseKey(key);
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let ts = target - 3600e3; // Startschätzung UTC+1
  for (let i = 0; i < 3; i++) {
    const p = berlinParts(ts);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    const delta = target - seen;
    if (delta === 0) break;
    ts += delta;
  }
  return ts;
}

/** "HH:MM" eines Zeitstempels in Berlin. */
export function timeOf(ts) {
  const p = berlinParts(ts);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

export function parseTime(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const hh = +m[1], mm = +m[2];
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MON = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
export const weekdayName = (key) => WD[weekday(key)];

/** "Do 12.11." bzw. "Heute"/"Gestern". */
export function labelDay(key, todayKey) {
  if (todayKey) {
    const dd = diffDays(key, todayKey);
    if (dd === 0) return 'Heute';
    if (dd === 1) return 'Gestern';
    if (dd === -1) return 'Morgen';
  }
  const { m, d } = parseKey(key);
  return `${WD[weekday(key)]} ${pad(d)}.${pad(m)}.`;
}
export function labelLong(key) {
  const { y, m, d } = parseKey(key);
  return `${WD[weekday(key)]}, ${d}. ${MON[m - 1]} ${y}`;
}
export function labelShort(key) {
  const { y, m, d } = parseKey(key);
  return `${pad(d)}.${pad(m)}.${String(y).slice(2)}`;
}
export function labelMonth(key) {
  const { y, m } = parseKey(key);
  return `${MON[m - 1]} ${y}`;
}

/**
 * Schlaf: Datum = logischer Aufwachtag. Liefert Zeitstempel für Einschlafen/Aufwachen.
 * Aufwachen vor dayStartHour → Kalendertag danach. Einschlafen liegt immer vor dem Aufwachen
 * (bei gleicher oder späterer Uhrzeit → Vortag).
 */
export function sleepTimestamps(dateKey, bed, wake, dayStartHour = 4) {
  const wakeCal = wake.hh < dayStartHour ? addDays(dateKey, 1) : dateKey;
  const wakeTs = wallToTs(wakeCal, wake.hh, wake.mm);
  let bedTs = wallToTs(wakeCal, bed.hh, bed.mm);
  if (bedTs >= wakeTs) bedTs = wallToTs(addDays(wakeCal, -1), bed.hh, bed.mm);
  return { bedTs, wakeTs, durationMin: Math.round((wakeTs - bedTs) / 60000) };
}

export function fmtDuration(min) {
  if (min == null || !isFinite(min)) return '–';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${h}:${pad(m)} h`;
}
export function fmtHMS(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
/** "1:02:03", "45:10", "45" (=Minuten) → Sekunden */
export function parseHMS(str) {
  const parts = String(str || '').trim().split(':').map((x) => x.trim());
  if (!parts[0] || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.length === 1) return n[0] * 60;
  if (n.length === 2) return n[0] * 60 + n[1];
  if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
  return null;
}
