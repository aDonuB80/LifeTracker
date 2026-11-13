// social.js – Familie & Freunde (Ereignisse, Personen) und das neutrale ⭐-Modul.
import * as db from './db.js';
import { state, changed, today } from './state.js';
import { h, clear, sheet, toast, field, textInput, dateInput, timeInput, scale10, confirmSheet, emptyState, suggestChips } from './ui.js';
import { fmt, norm } from './stats.js';
import { isValidKey, parseTime, labelDay, labelMonth, addDays } from './dates.js';

const personName = (id) => state.people.find((p) => p.id === id)?.name || '?';
export const peopleNames = (ids) => (ids || []).map(personName).join(', ');

/** Bisherige Ereignistypen, nach Häufigkeit sortiert (für Autocomplete). */
async function knownTypes() {
  const cnt = new Map();
  for (const e of await db.all('events')) if (e.type) cnt.set(e.type, (cnt.get(e.type) || 0) + 1);
  return [...cnt].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

// --- Personen-Auswahl (Chips, Mehrfachauswahl, Anlage inline) ------------------------------

function personPicker(selected) {
  const sel = new Set(selected || []);
  const box = h('div');
  const draw = () => {
    const ppl = state.people.filter((p) => !p.archived || sel.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const inp = textInput({ placeholder: 'Neue Person …', autocapitalize: 'words' });
    const add = async () => {
      const n = inp.value.trim();
      if (!n) return;
      let p = state.people.find((x) => norm(x.name) === norm(n));
      if (!p) { p = await db.put('people', { name: n, archived: false }); state.people.push(p); }
      sel.add(p.id); draw();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    clear(box,
      h('div.chips', ppl.map((p) => h('button.chip' + (sel.has(p.id) ? '.on' : ''), {
        type: 'button', onclick: () => { sel.has(p.id) ? sel.delete(p.id) : sel.add(p.id); draw(); },
      }, p.name)), !ppl.length && h('span.hint', 'Noch keine Personen – optional.')),
      h('div.row.gap', inp, h('button.btn.small.ghost', { type: 'button', onclick: add }, '＋')));
  };
  draw();
  return { el: box, value: () => [...sel] };
}

// --- Ereignis ------------------------------------------------------------------------------------

export async function openEventSheet(ev) {
  const types = await knownTypes();
  const isNew = !ev;
  ev = ev || { date: state.date || today(), personIds: [] };
  sheet(isNew ? 'Ereignis' : 'Ereignis bearbeiten', (close) => {
    const type = textInput({ value: ev.type || '', placeholder: 'Art des Ereignisses' });
    const d = dateInput(ev.date);
    const t = timeInput(ev.time || ''); t.required = false;
    const note = textInput({ value: ev.note || '', placeholder: 'optional' });
    const pp = personPicker(ev.personIds);
    return h('div',
      field('Was?', type), suggestChips(type, () => types),
      h('div.field', h('span.field-label', 'Mit wem? (optional)'), pp.el),
      h('div.grid2', field('Datum', d), field('Uhrzeit (optional)', t)),
      field('Notiz', note),
      h('div.row.gap.sticky-actions',
        !isNew && h('button.btn.ghost', {
          onclick: async () => { close(); await db.del('events', ev.id); changed(); toast('Ereignis gelöscht', { undo: async () => { await db.put('events', ev, { touch: false }); changed(); } }); },
        }, 'Löschen'),
        h('button.btn.primary.grow', {
          onclick: async () => {
            const ty = type.value.trim();
            if (!ty) return toast('Bitte angeben, was war.');
            if (ty.length > 120) return toast('Bezeichnung zu lang (max. 120 Zeichen).');
            if (!isValidKey(d.value)) return toast('Bitte ein gültiges Datum wählen.');
            if (t.value && !parseTime(t.value)) return toast('Uhrzeit ungültig.');
            Object.assign(ev, { type: ty, typeNorm: norm(ty), date: d.value, time: t.value || null, personIds: pp.value(), note: note.value.trim() || null });
            const saved = await db.put('events', ev);
            close(); changed();
            if (isNew) toast('Ereignis gespeichert', { undo: async () => { await db.del('events', saved.id); changed(); } });
          },
        }, 'Speichern')));
  }, { tall: true });
}

// --- Personen verwalten --------------------------------------------------------------------------

function openPeopleSheet() {
  sheet('Personen', () => {
    const box = h('div');
    const draw = () => clear(box,
      state.people.length ? h('div.card', [...state.people].sort((a, b) => a.name.localeCompare(b.name, 'de')).map((p) => {
        const inp = textInput({ value: p.name, autocapitalize: 'words' });
        inp.addEventListener('change', async () => { const n = inp.value.trim(); if (!n) { inp.value = p.name; return; } p.name = n; await db.put('people', p); changed(); });
        return h('div.row.gap.person-row', inp,
          h('button.btn.small.ghost', { onclick: async () => { p.archived = !p.archived; await db.put('people', p); draw(); changed(); } }, p.archived ? 'Aktivieren' : 'Archivieren'));
      })) : emptyState('Noch keine Personen. Sie entstehen beim Eintragen eines Ereignisses.'),
      h('p.hint', 'Archivierte Personen erscheinen nicht mehr in der Auswahl, bleiben aber in alten Einträgen erhalten.'));
    draw();
    return box;
  });
}

// --- ⭐ -----------------------------------------------------------------------------------------

export function openStarSheet(rec) {
  const isNew = !rec;
  rec = rec || { date: state.date || today(), time: null, score: null };
  sheet('⭐', (close) => {
    let score = rec.score;
    const d = dateInput(rec.date);
    const t = timeInput(rec.time || ''); t.required = false;
    return h('div',
      h('div.field', h('span.field-label', '⭐ 1–10'), scale10(score, (v) => { score = v; })),
      h('div.grid2', field('Datum', d), field('Uhrzeit (optional)', t)),
      h('div.row.gap.sticky-actions',
        !isNew && h('button.btn.ghost', {
          onclick: async () => { close(); await db.del('sz', rec.id); changed(); toast('⭐ gelöscht', { undo: async () => { await db.put('sz', rec, { touch: false }); changed(); } }); },
        }, 'Löschen'),
        h('button.btn.primary.grow', {
          onclick: async () => {
            if (score == null) return toast('Bitte eine Zahl 1–10 wählen.');
            if (!isValidKey(d.value)) return toast('Bitte ein gültiges Datum wählen.');
            if (t.value && !parseTime(t.value)) return toast('Uhrzeit ungültig.');
            Object.assign(rec, { score, date: d.value, time: t.value || null });
            const saved = await db.put('sz', rec);
            close(); changed();
            if (isNew) toast(`⭐ ${score}`, { undo: async () => { await db.del('sz', saved.id); changed(); } });
          },
        }, 'Speichern')));
  });
}

// --- Ansichten für Tab „Leben" --------------------------------------------------------------------

export async function renderEvents() {
  const t = today();
  const rows = (await db.range('events', 'date', addDays(t, -365), t)).sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''));
  const groups = new Map();
  for (const e of rows) { const k = e.date.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  return [
    h('div.row.gap', h('button.btn.primary.grow', { onclick: () => openEventSheet() }, '＋ Ereignis'), h('button.btn.ghost', { onclick: openPeopleSheet }, '👥 Personen')),
    groups.size ? [...groups].map(([k, arr]) => h('div.card',
      h('div.card-head', h('span', labelMonth(k + '-01')), h('span.sub', `${arr.length}×`)),
      arr.map((e) => h('button.list-row', { onclick: () => openEventSheet(e) },
        h('div.grow', h('div.name', e.type || 'Ereignis'), h('div.sub', [labelDay(e.date, t), e.time, peopleNames(e.personIds), e.note].filter(Boolean).join(' · '))),
        h('span.chev', '›')))))
      : emptyState('Noch keine Ereignisse im letzten Jahr.'),
  ];
}

export async function renderStars() {
  const t = today();
  const rows = (await db.range('sz', 'date', addDays(t, -365), t)).sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''));
  const last30 = rows.filter((r) => r.date > addDays(t, -30));
  const avg = last30.length ? last30.reduce((s, r) => s + r.score, 0) / last30.length : null;
  return [
    h('button.btn.primary.block', { onclick: () => openStarSheet() }, '＋ ⭐'),
    h('div.card', h('div.stats',
      h('div', h('div.sub', '30 Tage'), h('div.big', `⭐ ${last30.length}`)),
      h('div', h('div.sub', 'Ø 30 Tage'), h('div.big', avg != null ? fmt(avg, 1) : '–')),
      h('div', h('div.sub', '12 Monate'), h('div.big', `⭐ ${rows.length}`)))),
    rows.length ? h('div.card', rows.slice(0, 60).map((r) => h('button.list-row', { onclick: () => openStarSheet(r) },
      h('div.grow', h('div.name', labelDay(r.date, t)), r.time && h('div.sub', r.time)), h('div.num.big', `⭐ ${r.score}`))))
      : emptyState('Noch keine Einträge.'),
  ];
}
