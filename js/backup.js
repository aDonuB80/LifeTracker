// backup.js – JSON-Export (Teilen-Menü / Download) und Import mit Validierung + Migration.
import * as db from './db.js';
import { state, changed, loadCaches, saveSettings } from './state.js';
import { h, sheet, toast, confirmSheet } from './ui.js';
import { isValidKey, calendarKey } from './dates.js';

export const APP_ID = 'lifetrack';

export async function buildExport() {
  const data = {};
  for (const s of db.STORES) data[s] = await db.all(s);
  return { app: APP_ID, schemaVersion: db.SCHEMA_VERSION, exportedAt: new Date().toISOString(), data, settings: state.settings };
}

/** Teilen-Menü (iOS: „In Dateien sichern", AirDrop, Mail …), sonst Download. */
export async function exportBackup() {
  const obj = await buildExport();
  const name = `lifetrack-backup-${calendarKey()}.json`;
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  let ok = false;
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); ok = true; }
    catch (e) { if (e.name === 'AbortError') { toast('Export abgebrochen'); return false; } }
  }
  if (!ok) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  await db.setMeta('lastExportAt', Date.now());
  toast('Backup exportiert');
  changed();
  return true;
}

// --- Validierung --------------------------------------------------------------------

const isStr = (v, max = 500) => typeof v === 'string' && v.length <= max;
const isNum = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
const optNum = (v, lo, hi) => v == null || isNum(v, lo, hi);
const isTs = (v) => isNum(v, 0, 8.64e15);
const is10 = (v) => v == null || (Number.isInteger(v) && v >= 1 && v <= 10);

/** Feldprüfungen je Store; liefern Fehlertext oder null. */
const CHECK = {
  foods: (r) => !isStr(r.name, 200) || !r.name ? 'name' : !isStr(r.unit, 60) ? 'unit' : !isNum(r.kcal, 0, 10000) ? 'kcal' : !optNum(r.protein, 0, 1000) || !optNum(r.carbs, 0, 1000) || !optNum(r.fat, 0, 1000) ? 'makros' : null,
  foodLog: (r) => !isValidKey(r.date) ? 'date' : !r.snap || !isNum(r.snap.kcal, 0, 10000) || !isStr(r.snap.name, 200) ? 'snap' : !isNum(r.qty, 0.0001, 100) ? 'qty' : !['fruehstueck', 'mittag', 'abend', 'snack'].includes(r.meal) ? 'meal' : null,
  phases: (r) => !isStr(r.name, 100) ? 'name' : !isValidKey(r.start) ? 'start' : r.end != null && !isValidKey(r.end) ? 'end' : !isNum(r.kcal, 0, 20000) ? 'kcal' : !optNum(r.targetWeight, 20, 400) ? 'targetWeight' : null,
  weights: (r) => !isValidKey(r.date) ? 'date' : !isNum(r.kg, 20, 400) ? 'kg' : !isTs(r.ts) ? 'ts' : null,
  workouts: (r) => !isValidKey(r.date) ? 'date' : !['run', 'boulder', 'gym'].includes(r.type) ? 'type'
    : r.type === 'run' && (!isNum(r.distanceKm, 0, 1000) || !isNum(r.durationSec, 0, 1e6)) ? 'lauf'
      : r.type === 'boulder' && !Array.isArray(r.sends) ? 'sends'
        : r.type === 'gym' && !Array.isArray(r.items) ? 'items' : null,
  exercises: (r) => (!isStr(r.name, 200) ? 'name' : null),
  templates: (r) => (!isStr(r.name, 200) || !Array.isArray(r.exerciseIds) ? 'vorlage' : null),
  sleep: (r) => !isValidKey(r.date) ? 'date' : !isTs(r.bedTs) || !isTs(r.wakeTs) || r.wakeTs <= r.bedTs ? 'zeiten' : !is10(r.quality) ? 'quality' : null,
  days: (r) => !isValidKey(r.date) ? 'date' : !is10(r.mood) || !is10(r.stress) ? 'skala' : null,
  people: (r) => (!isStr(r.name, 200) ? 'name' : null),
  events: (r) => (!isValidKey(r.date) ? 'date' : !isStr(r.type || '', 200) ? 'type' : null),
  sz: (r) => (!isValidKey(r.date) ? 'date' : !is10(r.score) ? 'score' : null),
};

/** Prüft und migriert ein geparstes Backup. Rückgabe {ok, errors[], data, counts}. */
export function validateBackup(obj) {
  const errors = [];
  if (!obj || obj.app !== APP_ID || typeof obj.data !== 'object') return { ok: false, errors: ['Keine Lifetrack-Backupdatei.'] };
  if (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) return { ok: false, errors: ['Unbekannte Schema-Version.'] };
  if (obj.schemaVersion > db.SCHEMA_VERSION) return { ok: false, errors: [`Backup stammt aus einer neueren App-Version (Schema ${obj.schemaVersion}). Bitte App aktualisieren.`] };
  const data = structuredClone(obj.data);
  for (let v = obj.schemaVersion + 1; v <= db.SCHEMA_VERSION; v++) db.RECORD_MIGRATIONS[v]?.(data);
  const counts = {};
  for (const s of db.STORES) {
    const arr = data[s] ?? [];
    if (!Array.isArray(arr)) { errors.push(`${s}: keine Liste`); continue; }
    const key = db.KEY_OF[s] || 'id';
    const seen = new Set();
    arr.forEach((r, i) => {
      if (!r || typeof r !== 'object') return errors.push(`${s}[${i}]: kein Objekt`);
      if (!isStr(r[key], 100) || !r[key]) return errors.push(`${s}[${i}]: Schlüssel fehlt`);
      if (seen.has(r[key])) return errors.push(`${s}[${i}]: doppelter Schlüssel`);
      seen.add(r[key]);
      const bad = CHECK[s](r);
      if (bad) errors.push(`${s}[${i}]: ungültiges Feld „${bad}"`);
    });
    data[s] = arr;
    counts[s] = arr.length;
  }
  return { ok: errors.length === 0, errors, data, counts, settings: obj.settings, exportedAt: obj.exportedAt };
}

/** Zusammenführen: gleiche ID → neueres updatedAt gewinnt. */
async function mergeData(incoming) {
  const out = {};
  let added = 0, updated = 0;
  for (const s of db.STORES) {
    const key = db.KEY_OF[s] || 'id';
    const cur = new Map((await db.all(s)).map((r) => [r[key], r]));
    out[s] = [];
    for (const r of incoming[s]) {
      const c = cur.get(r[key]);
      if (!c) { out[s].push(r); added++; }
      else if ((r.updatedAt || 0) > (c.updatedAt || 0)) { out[s].push(r); updated++; }
    }
  }
  return { out, added, updated };
}

/**
 * Zusammenführen der Einstellungen: fehlende Boulder-Skalen (nach id) und Hallen-Zuordnungen
 * aus der Datei ergänzen; Vorhandenes bleibt unverändert. Liefert Anzahl der Ergänzungen.
 */
function mergeSettings(inc) {
  if (!inc || typeof inc !== 'object') return 0;
  const S = state.settings;
  let n = 0;
  for (const sc of Array.isArray(inc.gradeScales) ? inc.gradeScales : []) {
    const ok = sc && typeof sc.id === 'string' && typeof sc.name === 'string' && Array.isArray(sc.grades) && sc.grades.length >= 2 && sc.grades.every((g) => typeof g === 'string');
    if (ok && !S.gradeScales.some((x) => x.id === sc.id)) { S.gradeScales.push({ id: sc.id, name: sc.name, grades: [...sc.grades] }); n++; }
  }
  for (const [hall, id] of Object.entries(inc.hallScale && typeof inc.hallScale === 'object' ? inc.hallScale : {})) {
    if (typeof id === 'string' && !(hall in S.hallScale) && S.gradeScales.some((x) => x.id === id)) { S.hallScale[hall] = id; n++; }
  }
  return n;
}

const LABEL = { foods: 'Lebensmittel', foodLog: 'Essenseinträge', phases: 'Phasen', weights: 'Gewichtsmessungen', workouts: 'Sporteinheiten', exercises: 'Übungen', templates: 'Vorlagen', sleep: 'Schlafeinträge', days: 'Tageswerte', people: 'Personen', events: 'Ereignisse', sz: '⭐-Einträge' };

export async function importFile(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch { return toast('Datei ist kein gültiges JSON.'); }
  const v = validateBackup(obj);
  if (!v.ok) {
    return sheet('Import nicht möglich', () => h('div', h('p', `${v.errors.length} Problem(e) gefunden – es wurde nichts verändert.`),
      h('ul.errors', v.errors.slice(0, 15).map((e) => h('li', e))), v.errors.length > 15 && h('p.muted', `… und ${v.errors.length - 15} weitere`)));
  }
  sheet('Backup importieren', (close) => h('div',
    h('p.muted', `Backup vom ${v.exportedAt ? new Date(v.exportedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : '?'}`),
    h('ul.counts', db.STORES.filter((s) => v.counts[s]).map((s) => h('li', `${v.counts[s]} ${LABEL[s]}`))),
    h('button.btn.primary.block', {
      onclick: async () => {
        const { out, added, updated } = await mergeData(v.data);
        await db.bulkWrite(out, 'merge');
        const sAdded = mergeSettings(v.settings);
        if (sAdded) await saveSettings();
        await loadCaches(); close(); changed();
        toast(`Zusammengeführt: ${added} neu, ${updated} aktualisiert`);
      },
    }, 'Zusammenführen'),
    h('p.hint', 'Behält vorhandene Daten. Bei gleichen Einträgen gewinnt die neuere Version. Fehlende Boulder-Skalen aus der Datei werden ergänzt.'),
    h('button.btn.danger.block', {
      onclick: async () => {
        if (!(await confirmSheet('Alle Daten ersetzen?', 'Alle Daten auf diesem Gerät werden durch das Backup ersetzt. Tipp: vorher selbst exportieren.', 'Ersetzen', true))) return;
        await db.bulkWrite(v.data, 'replace');
        if (v.settings && typeof v.settings === 'object') { state.settings = { ...state.settings, ...v.settings }; await saveSettings(); }
        await loadCaches(); close(); changed();
        toast('Daten ersetzt');
      },
    }, 'Alles ersetzen'),
    h('button.btn.ghost.block', { onclick: () => exportBackup() }, 'Vorher aktuelles Backup exportieren')));
}
