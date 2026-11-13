// settings.js – Tab „Einstellungen": Backup, Allgemein, Boulder-Skalen, Speicherstatus.
import * as db from './db.js';
import { state, changed, saveSettings, loadCaches, nav } from './state.js';
import { h, clear, sheet, toast, field, textInput, numInput, segmented, confirmSheet } from './ui.js';
import { exportBackup, importFile } from './backup.js';
import { parseNum, norm } from './stats.js';
import { isStandalone } from './today.js';

export const APP_VERSION = '0.4.0';

function openScaleEditor(sc) {
  const S = state.settings;
  const isNew = !sc;
  sheet(isNew ? 'Neue Skala' : `Skala „${sc.name}"`, (close) => {
    const name = textInput({ value: sc?.name || '', placeholder: 'Name der Skala' });
    const grades = h('textarea.inp', { rows: 6, placeholder: 'Grade in Reihenfolge leicht → schwer,\neine Zeile pro Grad oder mit Komma getrennt' });
    grades.value = (sc?.grades || []).join('\n');
    return h('div',
      field('Name', name),
      field('Grade (leicht → schwer)', grades, 'Eine Zeile pro Grad oder mit Komma getrennt.'),
      h('div.row.gap.sticky-actions',
        !isNew && S.gradeScales.length > 1 && h('button.btn.ghost', {
          onclick: async () => {
            if (!(await confirmSheet('Skala löschen?', 'Bisherige Boulder-Einträge behalten ihre Grade.', 'Löschen', true))) return;
            S.gradeScales = S.gradeScales.filter((x) => x.id !== sc.id);
            if (S.defaultScaleId === sc.id) S.defaultScaleId = S.gradeScales[0].id;
            for (const k of Object.keys(S.hallScale)) if (S.hallScale[k] === sc.id) delete S.hallScale[k];
            await saveSettings(); close(); changed();
          },
        }, 'Löschen'),
        h('button.btn.primary.grow', {
          onclick: async () => {
            const n = name.value.trim();
            const g = [...new Set(grades.value.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean))];
            if (!n) return toast('Bitte einen Namen eingeben.');
            if (g.length < 2) return toast('Mindestens zwei Grade angeben.');
            if (S.gradeScales.some((x) => x !== sc && norm(x.name) === norm(n))) return toast('Name bereits vergeben.');
            if (isNew) S.gradeScales.push({ id: db.uid(), name: n, grades: g });
            else Object.assign(sc, { name: n, grades: g });
            await saveSettings(); close(); changed();
          },
        }, 'Speichern')));
  });
}

export async function renderSettings(root) {
  const S = state.settings;
  const set = async (k, v) => { S[k] = v; await saveSettings(); changed(); };
  const lastExport = await db.getMeta('lastExportAt', null);
  const persisted = (await navigator.storage?.persisted?.()) ?? null;
  const est = await navigator.storage?.estimate?.().catch(() => null);

  const fileInp = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); } });
  const remind = numInput({ value: String(S.backupReminderDays), inputmode: 'numeric' });
  remind.addEventListener('change', () => { const v = parseNum(remind.value); if (Number.isInteger(v) && v >= 1 && v <= 365) set('backupReminderDays', v); else toast('1–365 Tage'); });
  const szl = textInput({ value: S.szLabel, maxlength: 30 });
  szl.addEventListener('change', () => { const v = szl.value.trim(); if (v) set('szLabel', v); else szl.value = S.szLabel; });
  const rest = textInput({ value: S.restPresets.join(', ') });
  rest.addEventListener('change', () => {
    const v = rest.value.split(/[,; ]+/).map(Number).filter((x) => Number.isInteger(x) && x >= 10 && x <= 900);
    if (v.length) set('restPresets', v.slice(0, 6)); else toast('Sekundenwerte, z. B. 60, 90, 120');
  });

  clear(root,
    h('div.row.between', h('h2', 'Einstellungen'), h('button.btn.small.ghost', { onclick: () => nav.go('today') }, 'Fertig')),
    h('div.card',
      h('div.card-head', h('span', 'Backup')),
      h('p.sub', lastExport ? `Letzter Export: ${new Date(lastExport).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}` : 'Noch nie exportiert.'),
      h('div.row.gap', h('button.btn.primary.grow', { onclick: () => exportBackup() }, 'Exportieren / Teilen'), h('button.btn.ghost.grow', { onclick: () => fileInp.click() }, 'Importieren …'), fileInp),
      field('Erinnerung nach (Tagen)', remind),
      h('p.hint', 'Tipp: im Teilen-Menü „In Dateien sichern" → iCloud Drive wählen.')),
    h('div.card',
      h('div.card-head', h('span', 'Allgemein')),
      h('div.field', h('span.field-label', 'Tageswechsel um'), segmented([0, 2, 3, 4, 5, 6].map((x) => ({ id: x, label: `${x}:00` })), S.dayStartHour, (v) => set('dayStartHour', v), '.small')),
      h('div.field', h('span.field-label', 'Gewicht: Tageswert bei mehreren Messungen'), segmented([{ id: 'mean', label: 'Mittelwert' }, { id: 'last', label: 'Letzter Wert' }], S.weightDayMode, (v) => set('weightDayMode', v))),
      h('div.field', h('span.field-label', 'Prognose-Fenster'), segmented([{ id: 14, label: '14 Tage' }, { id: 28, label: '28 Tage' }], S.forecastWindow, (v) => set('forecastWindow', v))),
      field('Pausen-Timer (Sekunden)', rest),
      field('Bezeichnung für ⭐ in Auswertungen', szl, 'Nur dieser neutrale Name erscheint in Auswertungen; im Export heißt der Bereich „sz".')),
    h('div.card',
      h('div.card-head', h('span', 'Boulder-Skalen'), h('button.btn.small.ghost', { onclick: () => openScaleEditor(null) }, '＋ Neu')),
      S.gradeScales.map((sc) => h('div.list-row',
        h('button.grow.plain', { onclick: () => openScaleEditor(sc) }, h('div.name', sc.name, sc.id === S.defaultScaleId ? ' · Standard' : ''), h('div.sub', sc.grades.join(' · '))),
        sc.id !== S.defaultScaleId && h('button.btn.small.ghost', { onclick: () => set('defaultScaleId', sc.id) }, 'Standard'))),
      Object.keys(S.hallScale).length > 0 && h('p.hint', 'Pro Halle wird die zuletzt genutzte Skala gemerkt: ' + Object.entries(S.hallScale).map(([k, v]) => `${k} → ${S.gradeScales.find((x) => x.id === v)?.name || '?'}`).join(', '))),
    h('div.card',
      h('div.card-head', h('span', 'Speicher & App')),
      h('p.sub', `Dauerhafter Speicher: ${persisted == null ? 'unbekannt' : persisted ? 'ja ✓' : 'nein'}`),
      est && h('p.sub', `Belegt: ${(est.usage / 1048576).toFixed(1)} MB`),
      h('p.sub', `Modus: ${isStandalone() ? 'Home-Bildschirm-App ✓' : 'Browser-Tab (nicht installiert)'}`),
      h('p.sub', `Version ${APP_VERSION} · Schema ${db.SCHEMA_VERSION}`),
      h('div.row.gap',
        !persisted && h('button.btn.small.ghost', { onclick: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Dauerhafter Speicher gewährt' : 'Nicht gewährt – regelmäßige Backups sind umso wichtiger'); changed(); } }, 'Dauerhaft anfragen'),
        h('button.btn.small.ghost', { onclick: async () => { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); toast(r?.waiting ? 'Update bereit – App neu starten' : 'Aktuell'); } }, 'Nach Update suchen'))),
    h('div.card.danger-zone',
      h('div.card-head', h('span', 'Alle Daten löschen')),
      h('p.hint', 'Löscht alle Einträge auf diesem Gerät. Einstellungen bleiben.'),
      h('button.btn.danger.block', {
        onclick: async () => {
          if (!(await confirmSheet('Wirklich alles löschen?', 'Das kann nicht rückgängig gemacht werden. Vorher exportieren!', 'Weiter', true))) return;
          if (!(await confirmSheet('Letzte Sicherheitsabfrage', 'Alle Daten jetzt endgültig löschen?', 'Endgültig löschen', true))) return;
          await db.clearAll(); await loadCaches(); changed(); toast('Alle Daten gelöscht');
        },
      }, 'Alle Daten löschen …')));
}
