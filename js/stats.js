// stats.js – reine Rechenfunktionen (ohne DOM/DB), in Node testbar.
import { addDays, diffDays, weekStart, parseKey, keyOf, weekdayName } from './dates.js';

// --- Zahlen ---------------------------------------------------------------

/** "0,5" / "0.5" / " 1 " → Zahl; leer/ungültig → null */
export function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return null;
  return Number(s);
}

const nf = {};
export function fmt(n, digits = 0) {
  if (n == null || !isFinite(n)) return '–';
  nf[digits] ||= new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return nf[digits].format(n);
}
/** Menge kompakt: 1 → "1", 0.5 → "0,5", 0.25 → "0,25" */
export const fmtQty = (q) => fmt(q, Number.isInteger(q) ? 0 : (Math.round(q * 10) === q * 10 ? 1 : 2));

export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
}

// --- Ernährung --------------------------------------------------------------

export const MEALS = [
  { id: 'fruehstueck', label: 'Frühstück' },
  { id: 'mittag', label: 'Mittag' },
  { id: 'abend', label: 'Abend' },
  { id: 'snack', label: 'Snack' },
];
export const mealLabel = (id) => (MEALS.find((m) => m.id === id) || {}).label || id;

/** Mahlzeit-Vorschlag nach Uhrzeit (Berlin, Stunde als Dezimalzahl). */
export function mealForHour(h) {
  if (h >= 4 && h < 10.5) return 'fruehstueck';
  if (h >= 10.5 && h < 14.5) return 'mittag';
  if (h >= 17.5 && h < 22) return 'abend';
  return 'snack';
}

/** Nährwerte eines Log-Eintrags (Snapshot × Menge). Fehlende Makros bleiben null. */
export function entryNutrients(e) {
  const q = e.qty, s = e.snap;
  const m = (v) => (v == null ? null : v * q);
  return { kcal: s.kcal * q, protein: m(s.protein), carbs: m(s.carbs), fat: m(s.fat) };
}

export function sumNutrients(entries) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, missingMacros: 0 };
  for (const e of entries) {
    const n = entryNutrients(e);
    t.kcal += n.kcal;
    if (n.protein == null && n.carbs == null && n.fat == null) t.missingMacros++;
    t.protein += n.protein || 0; t.carbs += n.carbs || 0; t.fat += n.fat || 0;
  }
  return t;
}

// --- Phasen -----------------------------------------------------------------

export function phaseActiveOn(phases, key) {
  return phases.find((p) => p.start <= key && (!p.end || key <= p.end)) || null;
}

/** Überlappungsprüfung; liefert die kollidierende Phase oder null. */
export function phaseOverlap(phases, cand) {
  const cEnd = cand.end || '9999-12-31';
  return phases.find((p) => p.id !== cand.id && p.start <= cEnd && cand.start <= (p.end || '9999-12-31')) || null;
}

/** Makro-Ziele in Gramm (bei %-Modus aus kcal umgerechnet). */
export function phaseTargets(p) {
  if (!p) return null;
  const t = { kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat };
  if (p.macroMode === 'pct' && p.kcal) {
    const g = (pct, f) => (pct == null ? null : (p.kcal * pct / 100) / f);
    t.protein = g(p.protein, 4); t.carbs = g(p.carbs, 4); t.fat = g(p.fat, 9);
  }
  return t;
}

// --- Gewicht ----------------------------------------------------------------

/** Messungen → Map date → Tageswert ('mean' oder 'last'). */
export function weightDayValues(weights, mode = 'mean') {
  const by = new Map();
  for (const w of weights) {
    if (!by.has(w.date)) by.set(w.date, []);
    by.get(w.date).push(w);
  }
  const out = new Map();
  for (const [d, arr] of by) {
    if (mode === 'last') out.set(d, arr.reduce((a, b) => (b.ts > a.ts ? b : a)).kg);
    else out.set(d, arr.reduce((s, w) => s + w.kg, 0) / arr.length);
  }
  return out;
}

/**
 * Gleitender Mittelwert über `win` Kalendertage (rückwärts, inkl. Tag selbst).
 * Nur Tage mit Messung zählen; Ausgabe nur bei ≥ minN Werten im Fenster.
 */
export function rollingMean(dayMap, keys, win, minN) {
  const out = [];
  for (const k of keys) {
    let s = 0, n = 0;
    for (let i = 0; i < win; i++) {
      const v = dayMap.get(addDays(k, -i));
      if (v != null) { s += v; n++; }
    }
    out.push(n >= minN ? s / n : null);
  }
  return out;
}

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

/** Theil-Sen-Regression. pts = [{x, y}]. Liefert Steigung, Achsenabschnitt, 10/90-%-Steigungen. */
export function theilSen(pts) {
  const slopes = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      if (pts[j].x !== pts[i].x) slopes.push((pts[j].y - pts[i].y) / (pts[j].x - pts[i].x));
  if (!slopes.length) return null;
  const b = median(slopes);
  const a = median(pts.map((p) => p.y - b * p.x));
  return { slope: b, intercept: a, lo: quantile(slopes, 0.1), hi: quantile(slopes, 0.9) };
}

/**
 * Gewichtsprognose über die letzten `window` Tage bis `todayKey`.
 * Gibt {ok:false, reason} oder {ok:true, slopePerWeek, nowFit, fitAt(key), band, eta} zurück.
 */
export function weightForecast(dayMap, todayKey, window, targetKg) {
  const from = addDays(todayKey, -(window - 1));
  const pts = [];
  for (const [d, v] of dayMap) if (d >= from && d <= todayKey) pts.push({ x: diffDays(from, d), y: v });
  if (pts.length < 7) return { ok: false, reason: `Zu wenig Daten für eine Prognose: ${pts.length} von mindestens 7 Messtagen in den letzten ${window} Tagen.` };
  const ts = theilSen(pts);
  const xNow = diffDays(from, todayKey);
  const nowFit = ts.intercept + ts.slope * xNow;
  const res = {
    ok: true, n: pts.length, from, slope: ts.slope, slopeLo: ts.lo, slopeHi: ts.hi,
    slopePerWeek: ts.slope * 7, nowFit,
    fitAt: (key) => ts.intercept + ts.slope * diffDays(from, key),
    eta: null, etaNote: null,
  };
  if (targetKg != null) {
    const gap = targetKg - nowFit;
    const daysFor = (s) => (s !== 0 && Math.sign(s) === Math.sign(gap) ? gap / s : null);
    if (Math.abs(gap) < 0.05) res.etaNote = 'Zielgewicht erreicht (laut Trend).';
    else {
      const d = daysFor(ts.slope);
      if (d == null) res.etaNote = 'Der aktuelle Trend läuft nicht auf das Zielgewicht zu.';
      else if (d > 730) res.etaNote = 'Bei aktuellem Trend länger als 2 Jahre – keine Datumsschätzung.';
      else {
        // Schnellere/langsamere Steigung aus dem 10–90-%-Band
        const cands = [ts.lo, ts.hi].map(daysFor).filter((x) => x != null && x <= 1460);
        res.eta = {
          key: addDays(todayKey, Math.round(d)),
          early: cands.length ? addDays(todayKey, Math.round(Math.min(...cands))) : null,
          late: cands.length === 2 ? addDays(todayKey, Math.round(Math.max(...cands))) : null,
        };
      }
    }
  }
  return res;
}

// --- Sport ------------------------------------------------------------------

/** Pace in Sekunden pro km */
export const pace = (distanceKm, durationSec) => (distanceKm > 0 ? durationSec / distanceKm : null);

/** Epley-1RM */
export const e1rm = (kg, reps) => (reps <= 0 ? 0 : reps === 1 ? kg : kg * (1 + reps / 30));

/** Bestwerte je Übung aus Gym-Workouts. */
export function gymRecords(workouts) {
  const rec = new Map();
  for (const w of workouts) {
    if (w.type !== 'gym') continue;
    for (const it of w.items || []) {
      const r = rec.get(it.exerciseId) || { name: it.nameSnap, maxKg: null, maxE1rm: null, maxSetVol: null, maxReps: null, date: {} };
      for (const s of it.sets || []) {
        if (!(s.reps > 0)) continue;
        const kg = s.kg || 0;
        const upd = (field, v) => { if (r[field] == null || v > r[field]) { r[field] = v; r.date[field] = w.date; } };
        upd('maxKg', kg); upd('maxE1rm', e1rm(kg, s.reps)); upd('maxSetVol', kg * s.reps); upd('maxReps', s.reps);
      }
      r.name = it.nameSnap || r.name;
      rec.set(it.exerciseId, r);
    }
  }
  return rec;
}

export const gymVolume = (w) => (w.items || []).reduce((s, it) => s + (it.sets || []).reduce((a, x) => a + (x.kg || 0) * (x.reps || 0), 0), 0);
export const boulderCount = (w) => (w.sends || []).reduce((s, x) => s + x.n, 0);

// --- Aggregation (Auswertung) -------------------------------------------------------

export const mean = (arr) => { const v = arr.filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/** Bucket-Start eines Tages: Montag der Woche bzw. Monatserster. */
export const bucketOf = (key, unit) => (unit === 'month' ? key.slice(0, 8) + '01' : weekStart(key));

/** Liste aller Bucket-Starts von `from` bis `to`. */
export function bucketList(from, to, unit) {
  const out = [];
  let k = bucketOf(from, unit);
  while (k <= to) {
    out.push(k);
    if (unit === 'month') { const [y, m] = k.split('-').map(Number); k = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; }
    else k = addDays(k, 7);
  }
  return out;
}

/** Gruppiert Datensätze nach Bucket; liefert Map bucket → Array. */
export function groupBy(rows, unit, getKey = (r) => r.date) {
  const m = new Map();
  for (const r of rows) { const b = bucketOf(getKey(r), unit); if (!m.has(b)) m.set(b, []); m.get(b).push(r); }
  return m;
}

/** Chronologische PR-Ereignisse (erste Einheit je Übung zählt nicht). */
export function prEvents(workouts) {
  const best = new Map(), out = [];
  const sorted = workouts.filter((w) => w.type === 'gym').sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  for (const w of sorted) for (const it of w.items || []) {
    let mk = 0, me = 0;
    for (const s of it.sets || []) if (s.reps > 0) { mk = Math.max(mk, s.kg || 0); me = Math.max(me, e1rm(s.kg || 0, s.reps)); }
    const b = best.get(it.exerciseId);
    if (b && (mk > b.kg || me > b.e1rm + 0.01)) out.push({ date: w.date, name: it.nameSnap, kg: mk, e1rm: me, kgPR: mk > b.kg });
    best.set(it.exerciseId, { kg: Math.max(b?.kg || 0, mk), e1rm: Math.max(b?.e1rm || 0, me) });
  }
  return out;
}

// --- Wiederkehrende Todos -------------------------------------------------------------
// repeat = { unit: 'week' | 'month', interval: n ≥ 1, anchor: 'YYYY-MM-DD', monthDay?: 1–31 }

export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** k-te Wiederholung ab dem Anker (k = 0 → Anker selbst). Monatlich: 31. → letzter Tag kurzer Monate. */
export function occurrence(r, k) {
  if (r.unit === 'week') return addDays(r.anchor, 7 * r.interval * k);
  const { y, m, d } = parseKey(r.anchor);
  const mi = (m - 1) + r.interval * k;
  const yy = y + Math.floor(mi / 12), mm = ((mi % 12) + 12) % 12 + 1;
  return keyOf(yy, mm, Math.min(r.monthDay || d, daysInMonth(yy, mm)));
}

/** Erste Wiederholung, die strikt nach `key` liegt. */
export function nextOccurrenceAfter(r, key) {
  let k;
  if (r.unit === 'week') k = Math.max(0, Math.floor(diffDays(r.anchor, key) / (7 * r.interval)));
  else {
    const a = parseKey(r.anchor), b = parseKey(key);
    k = Math.max(0, Math.floor(((b.y - a.y) * 12 + (b.m - a.m)) / r.interval) - 1);
  }
  let o = occurrence(r, k);
  while (o <= key) o = occurrence(r, ++k);
  return o;
}

/** Klartext, z. B. „jeden Mo", „alle 2 Wochen (Fr)", „jeden Monat am 15.". */
export function repeatLabel(r) {
  if (!r) return '';
  if (r.unit === 'week') return r.interval === 1 ? `jeden ${weekdayName(r.anchor)}` : `alle ${r.interval} Wochen (${weekdayName(r.anchor)})`;
  const d = r.monthDay || parseKey(r.anchor).d;
  return r.interval === 1 ? `jeden Monat am ${d}.` : `alle ${r.interval} Monate am ${d}.`;
}
