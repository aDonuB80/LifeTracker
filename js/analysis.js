// analysis.js – Tab „Auswertung" (MVP: Gewicht mit Mittelwerten und Prognose).
import * as db from './db.js';
import { state, changed, today, saveSettings } from './state.js';
import { h, clear, segmented, emptyState } from './ui.js';
import {
  fmt, weightDayValues, rollingMean, weightForecast, mean, bucketList, groupBy, prEvents, pace, gymVolume, boulderCount,
  sumNutrients, phaseActiveOn, phaseTargets,
} from './stats.js';
import { addDays, diffDays, labelShort, labelDay, timeOf, isoWeek, weekStart, parseKey, fmtDuration, fmtHMS, weekdayName } from './dates.js';
import { timeChart, barChart } from './charts.js';
import { workoutSummary } from './sport.js';
import { activePhase } from './food.js';
import { openWeightSheet } from './body.js';

let sub = 'week';
let period = '3m';
const PERIODS = [{ id: '4w', label: '4 W', days: 28 }, { id: '3m', label: '3 M', days: 91 }, { id: '1y', label: '1 J', days: 365 }, { id: 'all', label: 'Alles', days: null }];

export async function renderAnalysis(root) {
  const seg = segmented([{ id: 'week', label: 'Woche' }, { id: 'weight', label: 'Gewicht' }, { id: 'sport', label: 'Sport' }, { id: 'well', label: 'Befinden' }], sub, (s) => { sub = s; changed(); }, '.top');
  const view = { week: renderWeek, weight: renderWeight, sport: renderSportTrends, well: renderWellTrends }[sub];
  clear(root, seg, ...(await view()));
}

async function renderWeight() {
  const t = today();
  const all = await db.all('weights');
  if (!all.length) return [emptyState('Noch keine Gewichtsmessungen.', h('button.btn.primary', { onclick: () => openWeightSheet() }, '＋ Gewicht eintragen'))];
  const dayMap = weightDayValues(all, state.settings.weightDayMode);
  const first = [...dayMap.keys()].sort()[0];
  const p = PERIODS.find((x) => x.id === period);
  const from = p.days ? addDays(t, -(p.days - 1)) : first;
  const win = state.settings.forecastWindow;
  const phase = activePhase(t);
  const target = phase?.targetWeight ?? null;
  const fc = weightForecast(dayMap, t, win, target);

  // Tagesschlüssel im Zeitraum
  const keys = [];
  for (let k = from; k <= t; k = addDays(k, 1)) keys.push(k);
  const m7 = rollingMean(dayMap, keys, 7, 3), m14 = rollingMean(dayMap, keys, 14, 5);
  const raw = keys.filter((k) => dayMap.has(k)).map((k) => ({ k, y: dayMap.get(k) }));

  let to = t;
  const series = [
    { kind: 'points', cls: 'raw', data: raw },
    { kind: 'line', cls: 'm7', data: keys.map((k, i) => ({ k, y: m7[i] })) },
    { kind: 'line', cls: 'm14', data: keys.map((k, i) => ({ k, y: m14[i] })) },
  ];
  if (fc.ok) {
    const span = diffDays(from, t);
    const horizon = Math.min(365, Math.max(14, fc.eta ? diffDays(t, fc.eta.key) + 7 : Math.round(span * 0.25)));
    to = addDays(t, horizon);
    const band = [], line = [];
    for (let i = 0; i <= horizon; i += Math.max(1, Math.round(horizon / 60))) {
      const k = addDays(t, i);
      const a = fc.nowFit + fc.slopeLo * i, b = fc.nowFit + fc.slopeHi * i;
      band.push({ k, lo: Math.min(a, b), hi: Math.max(a, b) });
    }
    const fitStart = fc.from > from ? fc.from : from;
    line.push({ k: fitStart, y: fc.fitAt(fitStart) }, { k: to, y: fc.fitAt(to) });
    series.unshift({ kind: 'band', cls: 'fc', data: band });
    series.push({ kind: 'line', cls: 'fc', dashed: true, data: line });
  }
  const chart = timeChart({
    from, to, series,
    hlines: target != null ? [{ y: target, label: `Ziel ${fmt(target, 1)}`, cls: 'target' }] : [],
    tooltip: (k) => {
      const i = diffDays(from, k);
      const parts = [];
      if (dayMap.has(k)) parts.push(`${fmt(dayMap.get(k), 1)} kg`);
      if (m7[i] != null) parts.push(`Ø7 ${fmt(m7[i], 1)}`);
      if (k > t && fc.ok) parts.push(`Trend ${fmt(fc.fitAt(k), 1)} (Schätzung)`);
      return parts.join(' · ') || 'keine Messung';
    },
  });

  const lastI = keys.length - 1;
  const recent = [...all].sort((a, b) => b.ts - a.ts).slice(0, 30);
  return [
    h('div.row.between',
      segmented(PERIODS.map(({ id, label }) => ({ id, label })), period, (x) => { period = x; changed(); }, '.small'),
      h('button.btn.small.primary', { onclick: () => openWeightSheet() }, '＋')),
    h('div.card', chart,
      h('div.legend', h('span.lg.raw', 'Messung'), h('span.lg.m7', 'Ø 7 T'), h('span.lg.m14', 'Ø 14 T'), fc.ok && h('span.lg.fc', 'Prognose'))),
    h('div.card',
      h('div.card-head', h('span', 'Trend'), segmented([{ id: 14, label: '14 T' }, { id: 28, label: '28 T' }], win, async (v) => { state.settings.forecastWindow = v; await saveSettings(); changed(); }, '.small')),
      h('div.stats',
        h('div', h('div.sub', 'Ø 7 Tage'), h('div.big', m7[lastI] != null ? `${fmt(m7[lastI], 1)} kg` : '–')),
        h('div', h('div.sub', 'Ø 14 Tage'), h('div.big', m14[lastI] != null ? `${fmt(m14[lastI], 1)} kg` : '–')),
        h('div', h('div.sub', 'Trend/Woche'), h('div.big', fc.ok ? `${fc.slopePerWeek > 0 ? '+' : ''}${fmt(fc.slopePerWeek, 2)} kg` : '–'))),
      fc.ok
        ? h('div.forecast',
          h('p', h('b', 'Schätzung: '), `robuste Regression (Theil-Sen) über ${fc.n} Messtage der letzten ${win} Tage. Band = 10–90 % der Trendsteigungen.`),
          target == null ? h('p.muted', phase ? `In der Phase „${phase.name}" ist kein Zielgewicht hinterlegt.` : 'Keine aktive Phase mit Zielgewicht.')
            : fc.eta ? h('p', `Zielgewicht ${fmt(target, 1)} kg voraussichtlich um den `, h('b', `${labelShort(fc.eta.key)} (KW ${isoWeek(fc.eta.key)})`),
              fc.eta.early && fc.eta.late ? ` – Spanne ${labelShort(fc.eta.early)} bis ${labelShort(fc.eta.late)}.` : fc.eta.early ? ` – frühestens ${labelShort(fc.eta.early)}, spätestens offen.` : '.')
              : h('p.muted', fc.etaNote))
        : h('p.muted', fc.reason)),
    h('details.card', h('summary', `Messungen (${all.length})`),
      recent.map((w) => h('button.list-row', { onclick: () => openWeightSheet(w) },
        h('div.grow', h('div.name', labelDay(w.date, t)), h('div.sub', timeOf(w.ts))), h('div.num', `${fmt(w.kg, 1)} kg`)))),
  ];
}

// --- Gemeinsame Helfer -----------------------------------------------------------------------

const periodSeg = () => segmented(PERIODS.map(({ id, label }) => ({ id, label })), period, (x) => { period = x; changed(); }, '.small');

/** Zeitraum-Start; bei „Alles" frühestes Datum der übergebenen Datensätze. */
function periodFrom(t, rowsForAll) {
  const p = PERIODS.find((x) => x.id === period);
  if (p.days) return addDays(t, -(p.days - 1));
  const ds = rowsForAll.map((r) => r.date).filter(Boolean).sort();
  return ds[0] || addDays(t, -27);
}
const unitFor = (from, to) => (diffDays(from, to) > 370 ? 'month' : 'week');
const bucketLabel = (k, unit) => { const { m, y } = parseKey(k); return unit === 'month' ? `${m}/${String(y).slice(2)}` : `${isoWeek(k)}`; };
const bucketLong = (k, unit) => (unit === 'month' ? bucketLabel(k, unit) : `KW ${isoWeek(k)} (ab ${labelShort(k)})`);
const kv = (...pairs) => h('div.kv', pairs.filter(Boolean).flat());
const f1 = (v) => (v == null ? '–' : fmt(v, 1));

// --- Woche ---------------------------------------------------------------------------------

let weekOff = 0;
async function renderWeek() {
  const t = today();
  const ws = addDays(weekStart(t), 7 * weekOff), we = addDays(ws, 6), prevWs = addDays(ws, -7);
  const [food, weights, wos, sleep, days, sz, events] = await Promise.all([
    db.range('foodLog', 'date', ws, we), db.range('weights', 'date', prevWs, we), db.range('workouts', 'date', ws, we),
    db.range('sleep', 'date', ws, we), db.range('days', null, ws, we), db.range('sz', 'date', ws, we), db.range('events', 'date', ws, we),
  ]);
  const keys = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const dm = weightDayValues(weights, state.settings.weightDayMode);
  const rows = keys.map((k) => {
    const fe = food.filter((e) => e.date === k);
    const tg = phaseTargets(phaseActiveOn(state.phases, k));
    const n = sumNutrients(fe);
    const sl = sleep.find((x) => x.date === k);
    const dd = days.find((x) => x.date === k);
    const st = sz.filter((x) => x.date === k);
    return { k, logged: fe.length > 0, kcal: n.kcal, n, target: tg?.kcal ?? null, wos: wos.filter((w) => w.date === k), sl, dd, st, ev: events.filter((e) => e.date === k), w: dm.get(k) };
  });
  const logged = rows.filter((r) => r.logged);
  const withT = logged.filter((r) => r.target != null);
  const bal = withT.reduce((s, r) => s + r.kcal - r.target, 0);
  const wNow = mean(keys.map((k) => dm.get(k))), wPrev = mean(Array.from({ length: 7 }, (_, i) => dm.get(addDays(prevWs, i))));
  const ICON = { run: '🏃', boulder: '🧗', gym: '🏋️' };
  const cnt = (ty) => wos.filter((w) => w.type === ty).length;
  const km = wos.filter((w) => w.type === 'run').reduce((s, w) => s + w.distanceKm, 0);
  const label = state.settings.szLabel || 'Sternzeit';

  const chart = barChart({
    labels: keys.map((k) => weekdayName(k)),
    stacks: [
      { cls: '', values: rows.map((r) => (r.target != null ? Math.min(r.kcal, r.target) : r.kcal)) },
      { cls: 'over', values: rows.map((r) => (r.target != null ? Math.max(0, r.kcal - r.target) : 0)) },
    ],
    targets: rows.map((r) => r.target),
    tooltip: (i) => `${labelShort(keys[i])}: ${rows[i].logged ? fmt(rows[i].kcal) + ' kcal' : 'nichts erfasst'}${rows[i].target != null ? ' / Ziel ' + fmt(rows[i].target) : ''}`,
  });

  const th = (x) => h('div.th', x);
  const table = h('div.wtable',
    th('Tag'), th('kcal'), th('Sport'), th('Schlaf'), th('🙂/S'), th('⭐'), th('👥'),
    rows.flatMap((r) => {
      const fut = r.k > t;
      const kc = r.logged ? h('div' + (r.target != null ? (r.kcal > r.target * 1.05 ? '.over' : '.ok') : ''), fmt(r.kcal)) : h('div.sub', fut ? '' : '–');
      return [
        h('div', labelDay(r.k)), kc,
        h('div', r.wos.map((w) => ICON[w.type]).join('')),
        h('div', r.sl ? fmtDuration(r.sl.durationMin).replace(' h', '') : ''),
        h('div', r.dd && (r.dd.mood != null || r.dd.stress != null) ? `${r.dd.mood ?? '–'}/${r.dd.stress ?? '–'}` : ''),
        h('div', r.st.length ? r.st.map((x) => x.score).join(',') : ''),
        h('div', r.ev.length || ''),
      ];
    }));

  return [
    h('div.weeknav',
      h('button.icon-btn', { 'aria-label': 'Vorwoche', onclick: () => { weekOff--; changed(); } }, '‹'),
      h('div', `KW ${isoWeek(ws)} · ${labelShort(ws)}–${labelShort(we)}`),
      h('button.icon-btn', { 'aria-label': 'Folgewoche', disabled: weekOff >= 0, onclick: () => { weekOff++; changed(); } }, '›'),
      weekOff < 0 && h('button.btn.small.ghost', { onclick: () => { weekOff = 0; changed(); } }, 'Heute')),
    h('div.card', h('div.card-head', h('span', 'kcal vs. Ziel'), h('span.sub', withT.length ? `Bilanz ${bal > 0 ? '+' : ''}${fmt(bal)} kcal` : '')), chart),
    h('div.card', kv(
      [h('span', `Ø kcal (${logged.length} T. erfasst)`), h('span', logged.length ? `${fmt(mean(logged.map((r) => r.kcal)))}${withT.length ? ' / ' + fmt(mean(withT.map((r) => r.target))) : ''}` : '–')],
      [h('span', 'Ø P · KH · F'), h('span', logged.length ? `${fmt(mean(logged.map((r) => r.n.protein)))} · ${fmt(mean(logged.map((r) => r.n.carbs)))} · ${fmt(mean(logged.map((r) => r.n.fat)))} g` : '–')],
      [h('span', 'Gewicht Ø'), h('span', wNow != null ? `${fmt(wNow, 1)} kg${wPrev != null ? ` (${wNow - wPrev > 0 ? '+' : ''}${fmt(wNow - wPrev, 1)} zur Vorwoche)` : ''}` : '–')],
      [h('span', 'Sport'), h('span', wos.length ? `${wos.length}× · 🏃${cnt('run')} 🧗${cnt('boulder')} 🏋️${cnt('gym')}` : '–')],
      km > 0 && [h('span', 'Laufen'), h('span', `${fmt(km, 1)} km`)],
      [h('span', 'Schlaf · Qualität'), h('span', sleep.length ? `${fmtDuration(mean(sleep.map((x) => x.durationMin)))} · ${f1(mean(sleep.map((x) => x.quality)))}` : '–')],
      [h('span', 'Stimmung · Stress'), h('span', `${f1(mean(days.map((x) => x.mood)))} · ${f1(mean(days.map((x) => x.stress)))}`)],
      [h('span', `⭐ ${label}`), h('span', sz.length ? `${sz.length}× · Ø ${f1(mean(sz.map((x) => x.score)))}` : '–')],
      [h('span', 'Ereignisse'), h('span', events.length ? `${events.length}×` : '–')],
      [h('span', '📓 Tagebuch'), h('span', `${days.filter((x) => x.note && x.note.trim()).length} von 7 Tagen`)])),
    h('div.card', table),
    events.length > 0 && h('div.card', h('div.card-head', h('span', '👥 Ereignisse')), events.sort((a, b) => a.date.localeCompare(b.date)).map((e) =>
      h('div.list-row', h('div.grow', h('div.name', e.type), h('div.sub', labelDay(e.date, t))))) ),
    wos.length > 0 && h('div.card', h('div.card-head', h('span', '🏅 Einheiten')), wos.sort((a, b) => a.date.localeCompare(b.date)).map((w) =>
      h('div.list-row', h('span.ticon', ICON[w.type]), h('div.grow', h('div.name', labelDay(w.date, t)), h('div.sub', workoutSummary(w)))))),
  ];
}

// --- Sport-Trends -----------------------------------------------------------------------------

async function renderSportTrends() {
  const t = today();
  const allWos = period === 'all' ? await db.all('workouts') : null;
  const from = periodFrom(t, allWos || []);
  const ws = allWos ? allWos.filter((w) => w.date >= from && w.date <= t) : await db.range('workouts', 'date', from, t);
  const unit = unitFor(from, t);
  const buckets = bucketList(from, t, unit);
  const g = groupBy(ws, unit);
  const per = (fn) => buckets.map((b) => fn(g.get(b) || []));
  const labels = buckets.map((b) => bucketLabel(b, unit));
  const tip = (fn) => (i) => `${bucketLong(buckets[i], unit)}: ${fn(g.get(buckets[i]) || [])}`;
  const unitTxt = unit === 'month' ? 'Monat' : 'Woche';
  const out = [h('div.row.between', periodSeg(), h('span.sub', `pro ${unitTxt}`))];
  if (!ws.length) return [...out, emptyState('Keine Sporteinheiten im Zeitraum.')];

  // Einheiten gesamt
  const types = ['run', 'boulder', 'gym'];
  out.push(h('div.card', h('div.card-head', h('span', `Einheiten pro ${unitTxt}`), h('span.sub', `${ws.length} gesamt · Ø ${fmt(ws.length / buckets.length, 1)}`)),
    barChart({ labels, stacks: types.map((ty) => ({ cls: ty, values: per((a) => a.filter((w) => w.type === ty).length) })), tooltip: tip((a) => `${a.length} Einheiten`) }),
    h('div.legend', h('span.lg.run', 'Laufen'), h('span.lg.boulder', 'Bouldern'), h('span.lg.gym', 'Gym'))));

  // Laufen
  const runs = ws.filter((w) => w.type === 'run').sort((a, b) => a.date.localeCompare(b.date));
  if (runs.length) {
    const km = runs.reduce((s, r) => s + r.distanceKm, 0), sec = runs.reduce((s, r) => s + r.durationSec, 0);
    const paces = runs.map((r) => ({ k: r.date, y: pace(r.distanceKm, r.durationSec) / 60 }));
    out.push(h('div.card', h('div.card-head', h('span', '🏃 Laufen')),
      kv([h('span', 'Läufe · Distanz'), h('span', `${runs.length} · ${fmt(km, 1)} km`)],
        [h('span', 'Ø Pace · beste Pace'), h('span', `${fmtHMS(sec / km)} · ${fmtHMS(Math.min(...paces.map((p) => p.y)) * 60)} /km`)],
        [h('span', 'Längster Lauf'), h('span', `${fmt(Math.max(...runs.map((r) => r.distanceKm)), 1)} km`)]),
      h('div.sub', `km pro ${unitTxt}`),
      barChart({ labels, stacks: [{ cls: 'run', values: per((a) => a.filter((w) => w.type === 'run').reduce((s, r) => s + r.distanceKm, 0)) }], tooltip: tip((a) => `${fmt(a.filter((w) => w.type === 'run').reduce((s, r) => s + r.distanceKm, 0), 1)} km`), height: 140 }),
      runs.length >= 2 && [h('div.sub', 'Pace je Lauf (min/km, niedriger = schneller)'),
        timeChart({ from, to: t, series: [{ kind: 'line', cls: 'pace', data: paces }, { kind: 'points', cls: 'pace', data: paces }], yFmt: (v) => fmtHMS(v * 60), tooltip: (k) => { const r = runs.filter((x) => x.date === k); return r.length ? r.map((x) => `${fmt(x.distanceKm, 1)} km · ${fmtHMS(pace(x.distanceKm, x.durationSec))}/km`).join(' | ') : '–'; } })]));
  }

  // Bouldern
  const bos = ws.filter((w) => w.type === 'boulder');
  if (bos.length) {
    const byScale = new Map();
    for (const w of bos) { const id = w.scaleId || '?'; if (!byScale.has(id)) byScale.set(id, []); byScale.get(id).push(w); }
    const scaleBlocks = [...byScale].map(([id, arr]) => {
      const sc = state.settings.gradeScales.find((x) => x.id === id);
      const name = sc?.name || arr[0].scaleName || 'Skala ?';
      const counts = new Map();
      for (const w of arr) for (const s of w.sends || []) counts.set(s.grade, (counts.get(s.grade) || 0) + s.n);
      // Reihenfolge der Skala; unbekannte (umbenannte) Grade hinten anhängen
      const order = [...(sc?.grades || []).filter((gr) => counts.has(gr)), ...[...counts.keys()].filter((gr) => !sc?.grades.includes(gr))];
      const max = Math.max(...counts.values());
      const top = (sc?.grades || []).filter((gr) => counts.has(gr)).pop() || order.at(-1);
      return h('div', h('div.card-head', h('span.sub', `${name} · ${arr.length} Sessions · höchster Grad ${top}`)),
        order.map((gr) => h('div.hbar', h('span', gr), h('div.hbar-track', h('div.hbar-fill', { style: { width: (counts.get(gr) / max) * 100 + '%' } })), h('span.num', counts.get(gr)))));
    });
    out.push(h('div.card', h('div.card-head', h('span', '🧗 Bouldern'), h('span.sub', `${bos.reduce((s, w) => s + boulderCount(w), 0)} Boulder · Gefühl Ø ${f1(mean(bos.map((w) => w.feeling)))}`)),
      h('div.sub', `Boulder pro ${unitTxt}`),
      barChart({ labels, stacks: [{ cls: 'boulder', values: per((a) => a.filter((w) => w.type === 'boulder').reduce((s, w) => s + boulderCount(w), 0)) }], tooltip: tip((a) => `${a.filter((w) => w.type === 'boulder').reduce((s, w) => s + boulderCount(w), 0)} Boulder`), height: 140 }),
      scaleBlocks));
  }

  // Gym
  const gyms = ws.filter((w) => w.type === 'gym');
  if (gyms.length) {
    const prs = prEvents(await db.range('workouts', 'type_date', ['gym', '0000'], ['gym', '9999'])).filter((p) => p.date >= from).reverse();
    out.push(h('div.card', h('div.card-head', h('span', '🏋️ Gym'), h('span.sub', `${gyms.length} Einheiten · ${fmt(gyms.reduce((s, w) => s + gymVolume(w), 0) / 1000, 1)} t`)),
      h('div.sub', `Volumen pro ${unitTxt} (kg × Wdh.)`),
      barChart({ labels, stacks: [{ cls: 'gym', values: per((a) => a.filter((w) => w.type === 'gym').reduce((s, w) => s + gymVolume(w), 0)) }], tooltip: tip((a) => `${fmt(a.filter((w) => w.type === 'gym').reduce((s, w) => s + gymVolume(w), 0))} kg`), height: 140 }),
      h('div.sub', prs.length ? `PRs im Zeitraum (${prs.length})` : 'Keine PRs im Zeitraum.'),
      prs.slice(0, 15).map((p) => h('div.list-row', h('div.grow', h('div.name', `🏆 ${p.name}`), h('div.sub', labelShort(p.date))), h('div.num', p.kgPR ? `${fmt(p.kg, 1)} kg` : `e1RM ${fmt(p.e1rm, 1)}`)))));
  }
  return out;
}

// --- Befindens-Trends -----------------------------------------------------------------------------

let wellUnit = 'week';
async function renderWellTrends() {
  const t = today();
  const all = period === 'all';
  const [days, sleep, sz] = await Promise.all(all ? [db.all('days'), db.all('sleep'), db.all('sz')]
    : (() => { const f = periodFrom(t, []); return [db.range('days', null, f, t), db.range('sleep', 'date', f, t), db.range('sz', 'date', f, t)]; })());
  const from = periodFrom(t, [...days, ...sleep, ...sz]);
  const inP = (r) => r.date >= from && r.date <= t;
  const D = days.filter(inP), S = sleep.filter(inP), Z = sz.filter(inP);
  const unit = wellUnit;
  const buckets = bucketList(from, t, unit);
  const gD = groupBy(D, unit), gS = groupBy(S, unit), gZ = groupBy(Z, unit);
  const line = (g, get) => buckets.map((b) => ({ k: b, y: mean((g.get(b) || []).map(get)) }));
  const ser = (cls, data) => [{ kind: 'line', cls, data }, { kind: 'points', cls, data: data.filter((p) => p.y != null) }];
  const mood = line(gD, (x) => x.mood), stress = line(gD, (x) => x.stress), qual = line(gS, (x) => x.quality), dur = line(gS, (x) => (x.durationMin == null ? null : x.durationMin / 60));
  const to = buckets.at(-1) || t;
  const label = state.settings.szLabel || 'Sternzeit';
  const tip = (arrs) => (k) => arrs.map(([n, a]) => { const p = a.find((x) => x.k === k); return p && p.y != null ? `${n} ${fmt(p.y, 1)}` : null; }).filter(Boolean).join(' · ') || '–';

  return [
    h('div.row.between', periodSeg(), segmented([{ id: 'week', label: 'Woche' }, { id: 'month', label: 'Monat' }], wellUnit, (u) => { wellUnit = u; changed(); }, '.small')),
    h('div.card', kv(
      [h('span', 'Stimmung · Stress'), h('span', `${f1(mean(D.map((x) => x.mood)))} · ${f1(mean(D.map((x) => x.stress)))}`)],
      [h('span', 'Schlaf · Qualität'), h('span', S.length ? `${fmtDuration(mean(S.map((x) => x.durationMin)))} · ${f1(mean(S.map((x) => x.quality)))}` : '–')],
      [h('span', `⭐ ${label}`), h('span', Z.length ? `${Z.length}× · Ø ${f1(mean(Z.map((x) => x.score)))}` : '–')])),
    h('div.card', h('div.card-head', h('span', `Stimmung & Stress (Ø je ${unit === 'month' ? 'Monat' : 'Woche'})`)),
      D.length ? timeChart({ from: buckets[0], to, yMin: 1, yMax: 10, series: [...ser('mood', mood), ...ser('stress', stress)], tooltip: tip([['Stimmung', mood], ['Stress', stress]]) }) : emptyState('Keine Einträge.'),
      h('div.legend', h('span.lg.mood', 'Stimmung'), h('span.lg.stress', 'Stress'))),
    h('div.card', h('div.card-head', h('span', 'Schlaf')),
      S.length ? [timeChart({ from: buckets[0], to, series: ser('sleep', dur), yFmt: (v) => `${fmt(v, 1)} h`, tooltip: tip([['Dauer h', dur]]) }),
        timeChart({ from: buckets[0], to, yMin: 1, yMax: 10, series: ser('qual', qual), tooltip: tip([['Qualität', qual]]) })] : emptyState('Keine Einträge.'),
      h('div.legend', h('span.lg.sleep', 'Dauer (h)'), h('span.lg.qual', 'Qualität'))),
    h('div.card', h('div.card-head', h('span', `⭐ ${label}`), h('span.sub', 'separat von der Stimmung')),
      Z.length ? [
        barChart({ labels: buckets.map((b) => bucketLabel(b, unit)), stacks: [{ cls: 'star', values: buckets.map((b) => (gZ.get(b) || []).length) }], height: 120,
          tooltip: (i) => { const a = gZ.get(buckets[i]) || []; return `${bucketLong(buckets[i], unit)}: ${a.length}×${a.length ? ` · Ø ${fmt(mean(a.map((x) => x.score)), 1)}` : ''}`; } }),
        h('div.sub', 'Ø Zufriedenheit'),
        timeChart({ from: buckets[0], to, yMin: 1, yMax: 10, series: ser('star', line(gZ, (x) => x.score)), tooltip: tip([['Ø', line(gZ, (x) => x.score)]]) }),
      ] : emptyState('Keine Einträge.')),
  ];
}
