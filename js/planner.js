// planner.js – Termine und Todos (einmalig oder wöchentlich/monatlich wiederkehrend), Tab „Planer".
import * as db from './db.js';
import { state, changed, today } from './state.js';
import { h, clear, sheet, toast, field, textInput, dateInput, timeInput, segmented, numInput, emptyState } from './ui.js';
import { parseNum, nextOccurrenceAfter, repeatLabel } from './stats.js';
import { isValidKey, parseTime, labelDay, labelLong, addDays, diffDays, parseKey } from './dates.js';
import { personPicker, peopleNames } from './social.js';

const err = (m) => toast(m);

// ==== Todos =======================================================================================

/** Abhaken. Einmalig → erledigt; wiederkehrend → in History und auf nächsten Termin nach max(fällig, heute). */
export async function completeTodo(td) {
  const before = structuredClone(td);
  const t = today();
  if (td.repeat) {
    td.history = [...(td.history || []), { due: td.due, doneDate: t, doneAt: Date.now() }].slice(-100);
    td.due = nextOccurrenceAfter(td.repeat, td.due && td.due > t ? td.due : t);
  } else {
    td.done = true; td.doneAt = Date.now(); td.doneDate = t;
  }
  await db.put('todos', td);
  changed();
  toast(td.repeat ? `Erledigt – nächstes Mal ${labelDay(td.due, t)}` : 'Erledigt', {
    undo: async () => { await db.put('todos', before); changed(); },
  });
}
async function reopenTodo(td) {
  const before = structuredClone(td);
  Object.assign(td, { done: false, doneAt: null, doneDate: null });
  await db.put('todos', td); changed();
  toast('Wieder offen', { undo: async () => { await db.put('todos', before); changed(); } });
}

export function openTodoSheet(td) {
  const isNew = !td;
  td = td ? structuredClone(td) : { title: '', note: null, due: null, repeat: null, done: false };
  sheet(isNew ? 'Todo' : 'Todo bearbeiten', (close) => {
    const title = textInput({ value: td.title, placeholder: 'Was ist zu tun?', maxlength: 300 });
    const due = dateInput(td.due || ''); due.required = false;
    const note = textInput({ value: td.note || '', placeholder: 'optional' });
    let unit = td.repeat?.unit || 'none';
    const iv = numInput({ value: String(td.repeat?.interval || 1), inputmode: 'numeric' });
    const ivWrap = h('div');
    const desc = h('p.hint');
    const upd = () => {
      const n = parseNum(iv.value);
      ivWrap.style.display = unit === 'none' ? 'none' : '';
      if (unit === 'none') { desc.textContent = due.value ? '' : 'Ohne Datum: erscheint in „Ohne Datum".'; return; }
      if (!isValidKey(due.value)) { desc.textContent = 'Für Wiederholungen bitte ein (erstes) Fälligkeitsdatum wählen.'; return; }
      const r = { unit, interval: Number.isInteger(n) && n > 0 ? n : 1, anchor: due.value, monthDay: parseKey(due.value).d };
      const txt = `Wiederholt sich ${repeatLabel(r)}` + (unit === 'month' && r.monthDay > 28 ? ' (in kürzeren Monaten am letzten Tag)' : '');
      desc.textContent = txt.endsWith('.') ? txt : txt + '.';
    };
    due.addEventListener('input', upd); iv.addEventListener('input', upd);
    clear(ivWrap, h('div.row.gap', h('span', 'alle'), iv, h('span.ivunit')));
    const setUnitLbl = () => { const s = ivWrap.querySelector('.ivunit'); if (s) s.textContent = unit === 'month' ? 'Monat(e)' : 'Woche(n)'; };
    setUnitLbl(); upd();
    const hist = (td.history || []).slice(-5).reverse();
    return h('div',
      field('Todo', title),
      h('div.chips', [['Heute', 0], ['Morgen', 1], ['In 1 Woche', 7]].map(([l, n]) => h('button.chip', { type: 'button', onclick: () => { due.value = addDays(today(), n); upd(); } }, l)),
        h('button.chip', { type: 'button', onclick: () => { due.value = ''; upd(); } }, 'Kein Datum')),
      field('Fällig am', due),
      h('div.field', h('span.field-label', 'Wiederholen'),
        segmented([{ id: 'none', label: 'Nein' }, { id: 'week', label: 'Wöchentlich' }, { id: 'month', label: 'Monatlich' }], unit, (u) => { unit = u; setUnitLbl(); upd(); })),
      ivWrap, desc,
      field('Notiz', note),
      hist.length > 0 && h('p.hint', 'Zuletzt erledigt: ' + hist.map((x) => labelDay(x.doneDate)).join(', ')),
      h('div.row.gap.sticky-actions',
        !isNew && h('button.btn.ghost', {
          onclick: async () => {
            close(); await db.del('todos', td.id); changed();
            toast('Todo gelöscht', { undo: async () => { await db.put('todos', td, { touch: false }); changed(); } });
          },
        }, 'Löschen'),
        h('button.btn.primary.grow', {
          onclick: async () => {
            const tt = title.value.trim();
            if (!tt) return err('Bitte angeben, was zu tun ist.');
            const d = due.value || null;
            if (d && !isValidKey(d)) return err('Datum ungültig.');
            let repeat = null;
            if (unit !== 'none') {
              const n = parseNum(iv.value);
              if (!d) return err('Für Wiederholungen ein Fälligkeitsdatum wählen.');
              if (!(Number.isInteger(n) && n >= 1 && n <= 52)) return err('Intervall: ganze Zahl 1–52.');
              // Anker bleibt, solange Rhythmus und Datum unverändert sind
              const same = td.repeat && td.repeat.unit === unit && td.repeat.interval === n && td.due === d;
              repeat = same ? td.repeat : { unit, interval: n, anchor: d, monthDay: parseKey(d).d };
            }
            Object.assign(td, { title: tt, due: d, repeat, note: note.value.trim() || null });
            if (repeat) td.done = false;
            const saved = await db.put('todos', td);
            close(); changed();
            if (isNew) toast('Todo angelegt', { undo: async () => { await db.del('todos', saved.id); changed(); } });
          },
        }, 'Speichern')));
  });
}

/** Einzelne Todo-Zeile mit großem Abhak-Kreis. */
export function todoRow(td, t = today()) {
  const overdue = td.due && td.due < t && !td.done;
  const sub = [td.due && (overdue ? `überfällig seit ${labelDay(td.due, t)}` : labelDay(td.due, t)), td.repeat && `↻ ${repeatLabel(td.repeat)}`, td.note].filter(Boolean).join(' · ');
  return h('div.list-row.todo' + (td.done ? '.done' : ''),
    h('button.tick' + (td.done ? '.on' : ''), {
      'aria-label': td.done ? 'Wieder öffnen' : 'Erledigt',
      onclick: () => (td.done ? reopenTodo(td) : completeTodo(td)),
    }, td.done ? '✓' : ''),
    h('button.grow.plain', { onclick: () => openTodoSheet(td) }, h('div.name', td.title), sub && h('div.sub' + (overdue ? '.late' : ''), sub)));
}

/** Offene Todos, die bis einschließlich `key` fällig sind (für „Heute"). */
export async function todosDueBy(key) {
  return (await db.all('todos')).filter((x) => !x.done && x.due && x.due <= key).sort((a, b) => a.due.localeCompare(b.due));
}

let showDone = false;
async function renderTodos() {
  const t = today();
  const all = await db.all('todos');
  const open = all.filter((x) => !x.done);
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title, 'de');
  const groups = [
    ['Überfällig', open.filter((x) => x.due && x.due < t)],
    ['Heute', open.filter((x) => x.due === t)],
    ['Nächste 7 Tage', open.filter((x) => x.due && x.due > t && x.due <= addDays(t, 7))],
    ['Später', open.filter((x) => x.due && x.due > addDays(t, 7))],
    ['Ohne Datum', open.filter((x) => !x.due)],
  ];
  const done = all.filter((x) => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  // Schnelleingabe: Titel + Enter → Todo ohne Datum
  const quick = textInput({ placeholder: 'Neues Todo … (Enter)', enterkeyhint: 'done' });
  const addQuick = async () => {
    const v = quick.value.trim(); if (!v) return;
    const saved = await db.put('todos', { title: v, due: null, repeat: null, done: false, note: null });
    quick.value = ''; changed();
    toast('Todo angelegt', { undo: async () => { await db.del('todos', saved.id); changed(); } });
  };
  quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addQuick(); } });
  return [
    h('div.row.gap', quick, h('button.btn.primary', { onclick: () => openTodoSheet() }, '＋')),
    open.length ? groups.filter(([, a]) => a.length).map(([name, a]) => h('div.card' + (name === 'Überfällig' ? '.late-card' : ''),
      h('div.card-head', h('span', name), h('span.sub', `${a.length}`)), a.sort(byDue).map((x) => todoRow(x, t))))
      : emptyState('Keine offenen Todos.'),
    done.length > 0 && h('details.card', { open: showDone, ontoggle: (e) => { showDone = e.target.open; } },
      h('summary', `Erledigt (${done.length})`),
      done.slice(0, 50).map((x) => todoRow(x, t)),
      h('button.btn.small.ghost', {
        onclick: async () => {
          const old = done.filter((x) => x.doneDate && x.doneDate < addDays(t, -30));
          if (!old.length) return toast('Keine erledigten Todos älter als 30 Tage.');
          for (const x of old) await db.del('todos', x.id);
          changed();
          toast(`${old.length} alte erledigte Todos entfernt`, { undo: async () => { await db.putMany('todos', old); changed(); } });
        },
      }, 'Erledigte älter als 30 Tage entfernen')),
  ];
}

// ==== Termine =====================================================================================

export function openAppointmentSheet(ap) {
  const isNew = !ap;
  ap = ap ? structuredClone(ap) : { date: state.date || today(), time: null, endTime: null, title: '', location: null, note: null, personIds: [] };
  sheet(isNew ? 'Termin' : 'Termin bearbeiten', (close) => {
    const title = textInput({ value: ap.title, placeholder: 'Titel', maxlength: 200 });
    const d = dateInput(ap.date);
    const t1 = timeInput(ap.time || ''), t2 = timeInput(ap.endTime || '');
    t1.required = false; t2.required = false;
    const loc = textInput({ value: ap.location || '', placeholder: 'optional' });
    const note = textInput({ value: ap.note || '', placeholder: 'optional' });
    const pp = personPicker(ap.personIds);
    return h('div',
      field('Was?', title),
      field('Datum', d),
      h('div.grid2', field('Von (leer = ganztägig)', t1), field('Bis (optional)', t2)),
      field('Ort', loc),
      h('div.field', h('span.field-label', 'Mit wem? (optional)'), pp.el),
      field('Notiz', note),
      h('div.row.gap.sticky-actions',
        !isNew && h('button.btn.ghost', {
          onclick: async () => {
            close(); await db.del('appointments', ap.id); changed();
            toast('Termin gelöscht', { undo: async () => { await db.put('appointments', ap, { touch: false }); changed(); } });
          },
        }, 'Löschen'),
        !isNew && h('button.btn.ghost', {
          onclick: async () => {
            const copy = await db.put('appointments', { ...ap, id: undefined, createdAt: undefined, date: addDays(ap.date, 7) });
            close(); changed();
            toast(`Kopiert auf ${labelDay(copy.date)}`, { undo: async () => { await db.del('appointments', copy.id); changed(); } });
          },
        }, '+1 Woche'),
        h('button.btn.primary.grow', {
          onclick: async () => {
            const tt = title.value.trim();
            if (!tt) return err('Bitte einen Titel eingeben.');
            if (!isValidKey(d.value)) return err('Bitte ein gültiges Datum wählen.');
            if (t1.value && !parseTime(t1.value)) return err('Startzeit ungültig.');
            if (t2.value && !parseTime(t2.value)) return err('Endzeit ungültig.');
            if (t2.value && !t1.value) return err('Endzeit nur zusammen mit Startzeit.');
            if (t1.value && t2.value && t2.value <= t1.value) return err('Ende muss nach dem Beginn liegen.');
            Object.assign(ap, { title: tt, date: d.value, time: t1.value || null, endTime: t2.value || null, location: loc.value.trim() || null, note: note.value.trim() || null, personIds: pp.value() });
            const saved = await db.put('appointments', ap);
            close(); changed();
            if (isNew) toast(`Termin gespeichert: ${labelDay(saved.date, today())}`, { undo: async () => { await db.del('appointments', saved.id); changed(); } });
          },
        }, 'Speichern')));
  }, { tall: true });
}

const timeTxt = (a) => (a.time ? (a.endTime ? `${a.time}–${a.endTime}` : a.time) : 'ganztägig');
const byTime = (a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '');

export function appointmentRow(a, t = today(), withDate = false) {
  return h('button.list-row', { onclick: () => openAppointmentSheet(a) },
    h('div.ap-time', timeTxt(a)),
    h('div.grow', h('div.name', a.title), h('div.sub', [withDate && labelDay(a.date, t), a.location, peopleNames(a.personIds), a.note].filter(Boolean).join(' · '))),
    h('span.chev', '›'));
}

let showPast = false;
async function renderAppointments() {
  const t = today();
  const upcoming = (await db.range('appointments', 'date', t, addDays(t, 365))).sort(byTime);
  const past = showPast ? (await db.range('appointments', 'date', addDays(t, -90), addDays(t, -1))).sort(byTime).reverse() : [];
  const groups = new Map();
  for (const a of upcoming) { if (!groups.has(a.date)) groups.set(a.date, []); groups.get(a.date).push(a); }
  const relLabel = (k) => { const n = diffDays(t, k); return n <= 1 ? labelDay(k, t) : `${labelLong(k)} · in ${n} Tagen`; };
  return [
    h('button.btn.primary.block', { onclick: () => openAppointmentSheet() }, '＋ Termin'),
    groups.size ? [...groups].map(([k, arr]) => h('div.card' + (k === t ? '.today-card' : ''),
      h('div.card-head', h('span', relLabel(k))), arr.map((a) => appointmentRow(a, t))))
      : emptyState('Keine kommenden Termine.'),
    h('button.btn.ghost.block', { onclick: () => { showPast = !showPast; changed(); } }, showPast ? 'Vergangene ausblenden' : 'Vergangene (90 Tage) zeigen'),
    showPast && (past.length ? h('div.card', past.map((a) => appointmentRow(a, t, true))) : emptyState('Keine vergangenen Termine.')),
  ];
}

// ==== Tab „Planer" ================================================================================

let sub = 'todos';
export async function renderPlanner(root) {
  const seg = segmented([{ id: 'todos', label: 'Todos' }, { id: 'appts', label: 'Termine' }], sub, (s) => { sub = s; changed(); }, '.top');
  clear(root, seg, ...(sub === 'todos' ? await renderTodos() : await renderAppointments()));
}
