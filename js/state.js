// state.js – globaler App-Zustand, Caches und Änderungs-Benachrichtigung.
import * as db from './db.js';
import { logicalKey, berlinParts, labelDay, addDays, isValidKey } from './dates.js';
import { h } from './ui.js';

export const state = {
  settings: null,
  date: null,       // in „Heute"/„Essen" angezeigter Tag
  foods: [],        // Cache Lebensmittel (klein, für Live-Suche)
  phases: [],       // Cache Phasen
  exercises: [],    // Cache Übungen
  people: [],       // Cache Personen
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
/** Nach jeder Datenänderung aufrufen → aktuelle Ansicht wird neu gezeichnet. */
export function changed() { for (const fn of listeners) fn(); }

export const today = () => logicalKey(Date.now(), state.settings.dayStartHour);
export const nowHour = () => { const p = berlinParts(); return p.hh + p.mm / 60; };

export async function loadCaches() {
  [state.foods, state.phases, state.exercises, state.people] = await Promise.all([db.all('foods'), db.all('phases'), db.all('exercises'), db.all('people')]);
}
export async function saveSettings() { await db.saveSettings(state.settings); }

/** Kopfzeile mit Tag-Navigation ‹ Datum › (wirkt auf state.date). */
export function dateNav(extra) {
  const t = today();
  const go = (n) => { state.date = addDays(state.date, n); changed(); };
  const picker = h('input.date-overlay', {
    type: 'date', value: state.date, max: t, 'aria-label': 'Datum wählen',
    onchange: (e) => { if (isValidKey(e.target.value)) { state.date = e.target.value; changed(); } },
  });
  return h('div.datenav',
    h('button.icon-btn', { 'aria-label': 'Vortag', onclick: () => go(-1) }, '‹'),
    h('div.datenav-label', h('span', labelDay(state.date, t)), picker),
    h('button.icon-btn', { 'aria-label': 'Folgetag', disabled: state.date >= t, onclick: () => go(1) }, '›'),
    state.date !== t && h('button.btn.small.ghost', { onclick: () => { state.date = t; changed(); } }, 'Heute'),
    extra);
}
