// today.js – Startscreen „Heute" und das zentrale „+"-Menü.
import * as db from './db.js';
import { state, today, dateNav } from './state.js';
import { h, clear, sheet } from './ui.js';
import { fmt, weightDayValues, rollingMean } from './stats.js';
import { addDays, fmtDuration, timeOf, diffDays } from './dates.js';
import { nutritionCard, favorites, quickAdd, openFoodSheet } from './food.js';
import { openWeightSheet, openSleepSheet, openMoodSheet } from './body.js';
import { openRunSheet, openBoulderSheet, openGymSheet, openWorkout, workoutSummary, TYPE_LABEL } from './sport.js';
import { exportBackup } from './backup.js';
import { openEventSheet, openStarSheet, peopleNames } from './social.js';

export function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

export function openAddMenu() {
  const d = state.date || today();
  sheet('Eintragen', (close) => {
    const tile = (ico, label, fn) => h('button.btn.tile', { onclick: () => { close(); fn(); } }, ico, h('span', label));
    return h('div.grid3',
      // Essen öffnet direkt (synchron) für sofortigen Tastatur-Fokus
      h('button.btn.tile', { onclick: () => { close(); openFoodSheet({ date: d }); } }, '🍽', h('span', 'Essen')),
      tile('⚖️', 'Gewicht', () => openWeightSheet()),
      tile('😴', 'Schlaf', () => openSleepSheet()),
      tile('🏃', 'Lauf', () => openRunSheet()),
      tile('🧗', 'Bouldern', () => openBoulderSheet()),
      tile('🏋️', 'Gym', () => openGymSheet()),
      tile('🙂', 'Stimmung', () => openMoodSheet()),
      tile('👥', 'Ereignis', () => openEventSheet()),
      tile('⭐', '', () => openStarSheet()));
  });
}

export async function renderToday(root) {
  const key = state.date, t = today();
  const [entries, weights, workouts, sleepRows, day, lastExport] = await Promise.all([
    db.range('foodLog', 'date', key),
    db.range('weights', 'date', addDays(key, -13), key),
    db.range('workouts', 'date', key),
    db.range('sleep', 'date', key),
    db.get('days', key),
    db.getMeta('lastExportAt', null),
  ]);
  const [events, stars] = await Promise.all([db.range('events', 'date', key), db.range('sz', 'date', key)]);
  const dm = weightDayValues(weights, state.settings.weightDayMode);
  const wToday = dm.get(key);
  const m7 = rollingMean(dm, [key], 7, 3)[0];
  const sl = sleepRows[0];

  const mini = (title, main, sub, onclick) => h('button.card.mini', { onclick }, h('div.sub', title), h('div.big', main), sub && h('div.sub', sub));

  const out = [dateNav()];
  if (!isStandalone()) out.push(h('div.banner.warn', 'Hinweis: Du nutzt die App im Safari-Tab. Daten hier und in der Home-Bildschirm-App sind getrennt – bitte über „Zum Home-Bildschirm" installieren und nur dort eintragen.'));
  out.push(h('div', { onclick: () => openFoodSheet({ date: key }) }, nutritionCard(entries, key)));
  out.push(h('div.grid2',
    mini('⚖️ Gewicht', wToday != null ? `${fmt(wToday, 1)} kg` : 'eintragen', m7 != null ? `Ø7 ${fmt(m7, 1)} kg` : null, () => openWeightSheet()),
    mini('😴 Schlaf letzte Nacht', sl ? fmtDuration(sl.durationMin) : 'eintragen', sl ? `${timeOf(sl.bedTs)}–${timeOf(sl.wakeTs)}${sl.quality ? ` · Q ${sl.quality}` : ''}` : null, () => openSleepSheet(sl)),
    mini('🙂 Stimmung · Stress', day && (day.mood != null || day.stress != null) ? `${day.mood ?? '–'} · ${day.stress ?? '–'}` : 'eintragen', null, () => openMoodSheet(key)),
    workouts.length
      ? h('div.card.mini', h('div.sub', '🏅 Sport'), workouts.map((w) => h('button.plain.wk', { onclick: () => openWorkout(w) }, h('b', TYPE_LABEL[w.type]), h('div.sub', workoutSummary(w)))))
      : mini('🏅 Sport', 'eintragen', null, () => openAddMenu())));
  if (events.length || stars.length) {
    out.push(h('div.grid2',
      events.length > 0 && h('div.card.mini', h('div.sub', '👥 Ereignisse'), events.map((e) => h('button.plain.wk', { onclick: () => openEventSheet(e) }, h('b', e.type), e.personIds?.length > 0 && h('div.sub', peopleNames(e.personIds))))),
      stars.length > 0 && h('button.card.mini', { onclick: () => openStarSheet(stars.length === 1 ? stars[0] : undefined) },
        h('div.big', stars.map((s) => `⭐ ${s.score}`).join('  ')))));
  }

  // Backup-Erinnerung (unten, in Daumenreichweite)
  const days = lastExport ? diffDays(new Date(lastExport).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)) : null;
  if (days == null || days >= state.settings.backupReminderDays) {
    out.push(h('div.banner', h('div.grow', days == null ? 'Noch kein Backup exportiert.' : `Letztes Backup vor ${days} Tagen.`),
      h('button.btn.small.primary', { onclick: () => exportBackup() }, 'Jetzt sichern')));
  }

  const favs = favorites().slice(0, 12);
  out.push(h('div.card',
    h('div.card-head', h('span', 'Quick-Add'), h('span.sub', '1 Tap = 1 Einheit')),
    favs.length ? h('div.chips.quick', favs.map((f) => h('button.chip.big', { onclick: () => quickAdd(f, key) }, f.name, h('small', ` ${fmt(f.kcal)}`))))
      : h('p.hint', 'Markiere Lebensmittel mit ★, dann erscheinen sie hier.')));
  clear(root, ...out);
}
