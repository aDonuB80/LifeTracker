// food.js – Lebensmitteldatenbank, Essens-Erfassung, Phasen (Ziele) und Tab „Essen".
import * as db from './db.js';
import { state, changed, today, nowHour, dateNav } from './state.js';
import { h, clear, sheet, toast, field, numInput, textInput, dateInput, segmented, confirmSheet, emptyState } from './ui.js';
import {
  parseNum, fmt, fmtQty, norm, MEALS, mealLabel, mealForHour, entryNutrients, sumNutrients,
  phaseActiveOn, phaseTargets, phaseOverlap,
} from './stats.js';
import { labelDay, labelShort, isValidKey } from './dates.js';

const QTY = [0.25, 0.5, 1, 1.5, 2];
const UNITS = ['1 Stk.', '100 g', '100 ml', '1 Portion'];
const toStr = (n) => (n == null ? '' : String(Math.round(n * 100) / 100).replace('.', ','));
const snapOf = (f) => ({ name: f.name, unit: f.unit, kcal: f.kcal, protein: f.protein ?? null, carbs: f.carbs ?? null, fat: f.fat ?? null });
const macroStr = (n) => [['P', n.protein], ['KH', n.carbs], ['F', n.fat]]
  .filter(([, v]) => v != null).map(([l, v]) => ` · ${l} ${fmt(v)}`).join('');

// --- Abfragen ------------------------------------------------------------------

export function searchFoods(q) {
  const nq = norm(q), toks = nq.split(' ').filter(Boolean);
  if (!toks.length) return [];
  const score = (f) => (f.nameNorm.startsWith(nq) ? 1000 : 0) + (f.favorite ? 100 : 0) + Math.min(f.useCount || 0, 99);
  return state.foods.filter((f) => !f.archived && toks.every((t) => f.nameNorm.includes(t)))
    .sort((a, b) => score(b) - score(a)).slice(0, 40);
}
export const favorites = () => state.foods.filter((f) => f.favorite && !f.archived).sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
export const recents = (n = 12) => state.foods.filter((f) => f.lastUsedAt && !f.archived).sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, n);
export const activePhase = (key) => phaseActiveOn(state.phases, key);

export async function logFood(food, qty, meal, date) {
  const entry = await db.put('foodLog', { date, meal, foodId: food.id, snap: snapOf(food), qty, ts: Date.now() });
  food.useCount = (food.useCount || 0) + 1;
  food.lastUsedAt = Date.now();
  await db.put('foods', food, { touch: false });
  return entry;
}

/** 1-Tap-Eintrag (Quick-Add auf „Heute"). */
export async function quickAdd(food, date) {
  const e = await logFood(food, 1, mealForHour(nowHour()), date);
  changed();
  toast(`${food.name} · ${fmt(e.snap.kcal)} kcal`, { undo: async () => { await db.del('foodLog', e.id); changed(); } });
}

// --- Formular-Bausteine ----------------------------------------------------------

/** Felder für ein Lebensmittel; read() validiert und liefert die Werte oder wirft Error. */
function foodFields(f = {}) {
  const name = textInput({ value: f.name || '', placeholder: 'Name des Lebensmittels', maxlength: 120 });
  const unit = textInput({ value: f.unit || '', placeholder: 'z. B. 1 Stk., 100 g', maxlength: 40 });
  const kcal = numInput({ value: toStr(f.kcal), placeholder: 'kcal' });
  const p = numInput({ value: toStr(f.protein), placeholder: 'g' });
  const c = numInput({ value: toStr(f.carbs), placeholder: 'g' });
  const fa = numInput({ value: toStr(f.fat), placeholder: 'g' });
  const unitChips = h('div.chips', UNITS.map((u) => h('button.chip', { type: 'button', onclick: () => { unit.value = u; } }, u)));
  const el = h('div',
    field('Name', name),
    field('Bezugseinheit', unit), unitChips,
    field('kcal pro Einheit', kcal),
    h('div.grid3', field('Protein', p), field('KH', c), field('Fett', fa)),
    h('p.hint', 'Makros optional, jeweils pro Einheit.'));
  const read = () => {
    const v = { name: name.value.trim(), unit: unit.value.trim() };
    if (!v.name) throw new Error('Bitte einen Namen eingeben.');
    if (!v.unit) throw new Error('Bitte eine Bezugseinheit angeben (z. B. „1 Stk.").');
    v.kcal = parseNum(kcal.value);
    if (v.kcal == null || v.kcal < 0 || v.kcal > 10000) throw new Error('kcal: Zahl zwischen 0 und 10 000.');
    for (const [k, inp] of [['protein', p], ['carbs', c], ['fat', fa]]) {
      const raw = inp.value.trim();
      v[k] = raw ? parseNum(raw) : null;
      if (raw && (v[k] == null || v[k] < 0 || v[k] > 1000)) throw new Error('Makros: Zahl zwischen 0 und 1000 g.');
    }
    v.nameNorm = norm(v.name);
    return v;
  };
  return { el, read, name };
}

/** Mengenwahl + Mahlzeit + Datum; calcFn(q) liefert Vorschau-Text. */
function amountFields({ qty = 1, meal, date, calc }) {
  const qInp = numInput({ value: fmtQty(qty) });
  const out = h('div.calc');
  const chips = h('div.chips.qty');
  const upd = () => {
    const q = parseNum(qInp.value);
    for (const b of chips.children) b.classList.toggle('on', parseNum(b.textContent) === q);
    clear(out, q > 0 ? calc(q) : 'Menge ungültig');
  };
  for (const v of QTY) chips.append(h('button.chip', { type: 'button', onclick: () => { qInp.value = fmtQty(v); upd(); } }, fmtQty(v)));
  qInp.addEventListener('input', upd);
  let curMeal = meal;
  const dInp = dateInput(date);
  upd();
  const el = h('div', field('Menge (Multiplikator)', h('div.row.gap', chips, qInp)), out,
    h('div.field', h('span.field-label', 'Mahlzeit'), segmented(MEALS, curMeal, (m) => { curMeal = m; })),
    field('Datum', dInp));
  const read = () => {
    const q = parseNum(qInp.value);
    if (!(q > 0 && q <= 100)) throw new Error('Menge: Zahl größer 0 (max. 100).');
    if (!isValidKey(dInp.value)) throw new Error('Bitte ein gültiges Datum wählen.');
    return { qty: q, meal: curMeal, date: dInp.value };
  };
  return { el, read };
}

const err = (e) => toast(e.message || String(e));

// --- Essen eintragen (Sheet) ---------------------------------------------------

export function openFoodSheet(opts = {}) {
  const date = opts.date || state.date || today();
  const meal = opts.meal || mealForHour(nowHour());
  let search = null;
  const api = sheet('Essen eintragen', (close) => {
    const body = h('div');
    const showSearch = (q = '') => {
      search = h('input.inp.search', { type: 'search', placeholder: 'Lebensmittel suchen …', value: q, autocomplete: 'off', autocorrect: 'off', enterkeyhint: 'search' });
      const list = h('div.list');
      const row = (f) => h('button.list-row', { onclick: () => showAmount(f) },
        h('div.grow', h('div.name', f.favorite ? '★ ' : '', f.name), h('div.sub', `${f.unit} · ${fmt(f.kcal)} kcal`)), h('span.chev', '›'));
      const render = () => {
        const q = search.value.trim();
        const items = [];
        if (!q) {
          const fav = favorites(), rec = recents().filter((f) => !f.favorite);
          if (fav.length) items.push(h('div.list-head', '★ Favoriten'), ...fav.map(row));
          if (rec.length) items.push(h('div.list-head', 'Zuletzt verwendet'), ...rec.map(row));
          if (!items.length) items.push(h('p.muted', 'Noch keine Lebensmittel. Tippe einen Namen – du kannst es dann direkt anlegen.'));
        } else {
          const res = searchFoods(q);
          const create = h('button.list-row.create', { onclick: () => showCreate(q) }, h('span.plus', '＋'), h('span.grow', 'Neu anlegen: ', h('b', `„${q}"`)));
          if (!res.length) items.push(create);
          items.push(...res.map(row));
          if (res.length) items.push(create);
        }
        clear(list, ...items);
      };
      search.addEventListener('input', render);
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const r = searchFoods(search.value); r.length ? showAmount(r[0]) : search.value.trim() && showCreate(search.value.trim()); } });
      render();
      clear(body, search, list);
    };
    const showAmount = (f) => {
      const am = amountFields({ meal, date, calc: (q) => { const n = entryNutrients({ qty: q, snap: snapOf(f) }); return `= ${fmt(n.kcal)} kcal${macroStr(n)}`; } });
      clear(body,
        h('div.food-head', h('div.name.big', f.name), h('div.sub', `${f.unit} = ${fmt(f.kcal)} kcal`)),
        am.el,
        h('div.row.gap.sticky-actions',
          h('button.btn.ghost', { onclick: () => showSearch(search?.value || '') }, '‹ Suche'),
          h('button.btn.primary.grow', {
            onclick: async () => {
              try {
                const v = am.read();
                const e = await logFood(f, v.qty, v.meal, v.date);
                close(); changed();
                toast(`${f.name} · ${fmt(entryNutrients(e).kcal)} kcal`, { undo: async () => { await db.del('foodLog', e.id); changed(); } });
              } catch (x) { err(x); }
            },
          }, 'Eintragen')));
    };
    const showCreate = (name) => {
      const ff = foodFields({ name });
      let fav = false;
      const am = amountFields({ meal, date, calc: (q) => {
        try { const v = ff.read(); const n = entryNutrients({ qty: q, snap: v }); return `= ${fmt(n.kcal)} kcal${macroStr(n)}`; } catch { return '…'; }
      } });
      clear(body,
        h('div.list-head', 'Neues Lebensmittel'),
        ff.el,
        h('label.check', h('input', { type: 'checkbox', onchange: (e) => { fav = e.target.checked; } }), ' Als Favorit (Quick-Add auf „Heute")'),
        h('div.list-head', 'Gegessen'),
        am.el,
        h('div.row.gap.sticky-actions',
          h('button.btn.ghost', { onclick: () => showSearch(name) }, '‹'),
          h('button.btn.primary.grow', {
            onclick: async () => {
              try {
                const v = ff.read(), a = am.read();
                const f = await db.put('foods', { ...v, favorite: fav, archived: false, useCount: 0 });
                state.foods.push(f);
                const e = await logFood(f, a.qty, a.meal, a.date);
                close(); changed();
                toast(`Angelegt & eingetragen: ${fmt(entryNutrients(e).kcal)} kcal`, { undo: async () => { await db.del('foodLog', e.id); changed(); } });
              } catch (x) { err(x); }
            },
          }, 'Anlegen & eintragen')));
    };
    if (opts.food) showAmount(opts.food); else showSearch();
    return body;
  }, { tall: true });
  // Fokus synchron im Tap-Handler, damit iOS die Tastatur öffnet
  if (!opts.food) search?.focus({ preventScroll: true });
  return api;
}

// --- Eintrag bearbeiten ------------------------------------------------------------

function openEntrySheet(e) {
  sheet(e.snap.name, (close) => {
    const am = amountFields({ qty: e.qty, meal: e.meal, date: e.date, calc: (q) => { const n = entryNutrients({ qty: q, snap: e.snap }); return `= ${fmt(n.kcal)} kcal${macroStr(n)}`; } });
    return h('div',
      h('div.sub', `${e.snap.unit} = ${fmt(e.snap.kcal)} kcal (Stand beim Eintragen)`),
      e.note && h('p.hint', e.note),
      am.el,
      h('div.row.gap.sticky-actions',
        h('button.btn.ghost', {
          onclick: async () => {
            close();
            await db.del('foodLog', e.id); changed();
            toast('Eintrag gelöscht', { undo: async () => { await db.put('foodLog', e, { touch: false }); changed(); } });
          },
        }, 'Löschen'),
        h('button.btn.ghost', {
          onclick: async () => {
            try {
              const v = am.read();
              const copy = await db.put('foodLog', { ...e, ...v, id: undefined, createdAt: undefined, ts: Date.now() });
              close(); changed();
              toast('Dupliziert', { undo: async () => { await db.del('foodLog', copy.id); changed(); } });
            } catch (x) { err(x); }
          },
        }, 'Duplizieren'),
        h('button.btn.primary.grow', {
          onclick: async () => { try { Object.assign(e, am.read()); await db.put('foodLog', e); close(); changed(); } catch (x) { err(x); } },
        }, 'Speichern')));
  });
}

function openCopyDaySheet(fromKey, entries) {
  sheet('Tag kopieren', (close) => {
    const t = today();
    const dInp = dateInput(fromKey === t ? '' : t);
    return h('div',
      h('p.muted', `${entries.length} Einträge vom ${labelShort(fromKey)} kopieren nach:`),
      field('Zieldatum', dInp),
      h('button.btn.primary.block', {
        onclick: async () => {
          const to = dInp.value;
          if (!isValidKey(to) || to === fromKey) return toast('Bitte ein anderes gültiges Datum wählen.');
          const copies = entries.map((e) => ({ ...e, id: db.uid(), date: to, createdAt: Date.now(), updatedAt: Date.now(), ts: Date.now() }));
          await db.putMany('foodLog', copies);
          close(); changed();
          toast(`${copies.length} Einträge nach ${labelShort(to)} kopiert`, { undo: async () => { for (const c of copies) await db.del('foodLog', c.id); changed(); } });
        },
      }, 'Kopieren'));
  });
}

// --- Lebensmittel bearbeiten -----------------------------------------------------------

export function openFoodEditor(f) {
  const isNew = !f;
  f = f || { favorite: false, archived: false, useCount: 0 };
  sheet(isNew ? 'Neues Lebensmittel' : 'Lebensmittel bearbeiten', (close) => {
    const ff = foodFields(f);
    let fav = !!f.favorite, arch = !!f.archived, propagate = false;
    const fnote = textInput({ value: f.note || '', placeholder: 'z. B. Etikettwert, Richtwert' });
    return h('div',
      ff.el,
      field('Notiz (optional)', fnote),
      h('label.check', h('input', { type: 'checkbox', checked: fav, onchange: (e) => { fav = e.target.checked; } }), ' Favorit (Quick-Add)'),
      !isNew && h('label.check', h('input', { type: 'checkbox', checked: arch, onchange: (e) => { arch = e.target.checked; } }), ' Archiviert (in Suche ausgeblendet)'),
      !isNew && h('label.check', h('input', { type: 'checkbox', onchange: (e) => { propagate = e.target.checked; } }), ' Auch alle früheren Einträge mit diesen Werten aktualisieren'),
      !isNew && h('p.hint', 'Standard: frühere Einträge behalten ihre damaligen Werte.'),
      h('div.row.gap.sticky-actions',
        !isNew && h('button.btn.ghost', {
          onclick: async () => {
            if (!(await confirmSheet('Lebensmittel löschen?', 'Bisherige Einträge bleiben erhalten (mit ihren gespeicherten Werten).', 'Löschen', true))) return;
            await db.del('foods', f.id);
            state.foods = state.foods.filter((x) => x.id !== f.id);
            close(); changed();
            toast('Lebensmittel gelöscht', { undo: async () => { await db.put('foods', f, { touch: false }); state.foods.push(f); changed(); } });
          },
        }, 'Löschen'),
        h('button.btn.primary.grow', {
          onclick: async () => {
            try {
              Object.assign(f, ff.read(), { favorite: fav, archived: arch, note: fnote.value.trim() || null });
              await db.put('foods', f);
              if (isNew) state.foods.push(f);
              if (propagate) {
                const logs = await db.range('foodLog', 'foodId', f.id);
                for (const l of logs) { l.snap = snapOf(f); l.updatedAt = Date.now(); }
                await db.putMany('foodLog', logs);
                toast(`${logs.length} frühere Einträge aktualisiert`);
              }
              close(); changed();
            } catch (x) { err(x); }
          },
        }, 'Speichern')));
  }, { tall: true });
}

// --- Phasen ---------------------------------------------------------------------

export function openPhaseEditor(p) {
  const isNew = !p;
  p = p || { name: '', start: today(), end: null, kcal: null, macroMode: 'g', protein: null, carbs: null, fat: null, targetWeight: null, archived: false };
  sheet(isNew ? 'Neue Phase' : 'Phase bearbeiten', (close) => {
    const name = textInput({ value: p.name, placeholder: 'z. B. Cut, Erhaltung, Aufbau' });
    const start = dateInput(p.start), end = dateInput(p.end || '');
    end.required = false;
    const kcal = numInput({ value: toStr(p.kcal) });
    let mode = p.macroMode;
    const pr = numInput({ value: toStr(p.protein) }), cb = numInput({ value: toStr(p.carbs) }), ft = numInput({ value: toStr(p.fat) });
    const unitLbl = () => (mode === 'pct' ? '%' : 'g');
    const lbls = [h('span'), h('span'), h('span')];
    const setLbl = () => ['Protein', 'KH', 'Fett'].forEach((n, i) => { lbls[i].textContent = `${n} (${unitLbl()})`; });
    setLbl();
    const tw = numInput({ value: toStr(p.targetWeight), placeholder: 'kg' });
    let arch = !!p.archived;
    return h('div',
      field('Name', name),
      h('div.grid2', field('Start', start), field('Ende (leer = offen)', end)),
      field('kcal-Ziel pro Tag', kcal),
      h('div.field', h('span.field-label', 'Makro-Ziele in'), segmented([{ id: 'g', label: 'Gramm' }, { id: 'pct', label: '% der kcal' }], mode, (m) => { mode = m; setLbl(); })),
      h('div.grid3', h('label.field', lbls[0], pr), h('label.field', lbls[1], cb), h('label.field', lbls[2], ft)),
      field('Zielgewicht (kg, optional)', tw),
      !isNew && h('label.check', h('input', { type: 'checkbox', checked: arch, onchange: (e) => { arch = e.target.checked; } }), ' Archiviert (bleibt für vergangene Tage gültig)'),
      h('div.row.gap.sticky-actions',
        !isNew && h('button.btn.ghost', {
          onclick: async () => {
            if (!(await confirmSheet('Phase löschen?', 'Für diesen Zeitraum gibt es danach keine Ziele mehr.', 'Löschen', true))) return;
            await db.del('phases', p.id);
            state.phases = state.phases.filter((x) => x.id !== p.id);
            close(); changed();
            toast('Phase gelöscht', { undo: async () => { await db.put('phases', p, { touch: false }); state.phases.push(p); changed(); } });
          },
        }, 'Löschen'),
        h('button.btn.primary.grow', {
          onclick: async () => {
            const v = { name: name.value.trim(), start: start.value, end: end.value || null, macroMode: mode };
            if (!v.name) return toast('Bitte einen Namen eingeben.');
            if (!isValidKey(v.start)) return toast('Bitte ein Startdatum wählen.');
            if (v.end && (!isValidKey(v.end) || v.end < v.start)) return toast('Ende muss nach dem Start liegen.');
            v.kcal = parseNum(kcal.value);
            if (!(v.kcal >= 500 && v.kcal <= 10000)) return toast('kcal-Ziel: 500–10 000.');
            for (const [k, inp] of [['protein', pr], ['carbs', cb], ['fat', ft]]) {
              const raw = inp.value.trim(); v[k] = raw ? parseNum(raw) : null;
              if (raw && !(v[k] >= 0 && v[k] <= (mode === 'pct' ? 100 : 1000))) return toast('Makro-Ziel ungültig.');
            }
            if (mode === 'pct' && (v.protein || 0) + (v.carbs || 0) + (v.fat || 0) > 100.5) return toast('Makro-Prozente ergeben mehr als 100 %.');
            const twRaw = tw.value.trim(); v.targetWeight = twRaw ? parseNum(twRaw) : null;
            if (twRaw && !(v.targetWeight >= 30 && v.targetWeight <= 300)) return toast('Zielgewicht: 30–300 kg.');
            const clash = phaseOverlap(state.phases, { ...v, id: p.id });
            if (clash) return toast(`Überschneidet sich mit „${clash.name}" (${labelShort(clash.start)}–${clash.end ? labelShort(clash.end) : 'offen'}). Bitte dort zuerst ein Ende setzen.`);
            Object.assign(p, v, { archived: arch });
            await db.put('phases', p);
            if (isNew) state.phases.push(p);
            close(); changed();
          },
        }, 'Speichern')));
  }, { tall: true });
}

// --- Tagesbilanz-Karte (auch auf „Heute") ---------------------------------------------

export function ring(value, target, label) {
  const r = 52, c = 2 * Math.PI * r;
  const frac = target ? Math.min(value / target, 1.5) : 0;
  const over = target && value > target;
  const svg = `<svg viewBox="0 0 120 120" class="ring${over ? ' over' : ''}">
    <circle cx="60" cy="60" r="${r}" class="ring-bg"/>
    <circle cx="60" cy="60" r="${r}" class="ring-fg" stroke-dasharray="${c * Math.min(frac, 1)} ${c}" transform="rotate(-90 60 60)"/>
  </svg>`;
  const el = h('div.ring-wrap');
  el.innerHTML = svg;
  el.append(h('div.ring-label', h('div.big', fmt(value)), h('div.sub', target ? `von ${fmt(target)}` : label)));
  return el;
}

export function macroBar(label, val, target) {
  const pct = target ? Math.min(val / target, 1) * 100 : 0;
  return h('div.mbar', h('div.mbar-top', h('span', label), h('span.sub', target ? `${fmt(val)} / ${fmt(target)} g` : `${fmt(val)} g`)),
    h('div.mbar-track', h('div.mbar-fill' + (target && val > target * 1.05 ? '.over' : ''), { style: { width: pct + '%' } })));
}

export function nutritionCard(entries, key) {
  const tot = sumNutrients(entries);
  const ph = activePhase(key);
  const tg = phaseTargets(ph);
  const rest = tg ? tg.kcal - tot.kcal : null;
  return h('div.card.nutri',
    h('div.card-head', h('span', 'Ernährung'), h('span.sub', ph ? `Phase: ${ph.name}` : 'keine aktive Phase')),
    h('div.nutri-body',
      ring(tot.kcal, tg?.kcal, 'kcal'),
      h('div.grow',
        rest != null && h('div.rest' + (rest < 0 ? '.over' : ''), rest >= 0 ? `${fmt(rest)} kcal übrig` : `${fmt(-rest)} kcal drüber`),
        macroBar('Protein', tot.protein, tg?.protein),
        macroBar('KH', tot.carbs, tg?.carbs),
        macroBar('Fett', tot.fat, tg?.fat),
        tot.missingMacros > 0 && h('div.hint', `${tot.missingMacros} Einträge ohne Makroangaben`))));
}

// --- Tab „Essen" ----------------------------------------------------------------------

let sub = 'log';
let foodFilter = '';
let showArchived = false;

export async function renderFood(root) {
  const seg = segmented([{ id: 'log', label: 'Tagebuch' }, { id: 'foods', label: 'Lebensmittel' }, { id: 'phases', label: 'Phasen' }], sub, (s) => { sub = s; changed(); }, '.top');
  if (sub === 'log') return clear(root, seg, ...(await renderLog()));
  if (sub === 'foods') return clear(root, seg, ...renderFoods());
  return clear(root, seg, ...renderPhases());
}

async function renderLog() {
  const key = state.date;
  const entries = (await db.range('foodLog', 'date', key)).sort((a, b) => a.ts - b.ts);
  const out = [dateNav(), nutritionCard(entries, key)];
  for (const m of MEALS) {
    const es = entries.filter((e) => e.meal === m.id);
    const s = sumNutrients(es);
    out.push(h('div.card',
      h('div.card-head', h('span', m.label), h('span.sub', es.length ? `${fmt(s.kcal)} kcal` : ''),
        h('button.icon-btn.add', { 'aria-label': `${m.label} hinzufügen`, onclick: () => openFoodSheet({ date: key, meal: m.id }) }, '＋')),
      es.map((e) => h('button.list-row', { onclick: () => openEntrySheet(e) },
        h('div.grow', h('div.name', e.snap.name), h('div.sub', `${fmtQty(e.qty)} × ${e.snap.unit}`)),
        h('div.num', `${fmt(entryNutrients(e).kcal)}`)))));
  }
  if (entries.length) out.push(h('button.btn.ghost.block', { onclick: () => openCopyDaySheet(key, entries) }, 'Diesen Tag kopieren …'));
  return out;
}

function renderFoods() {
  const inp = h('input.inp.search', { type: 'search', placeholder: 'Filtern …', value: foodFilter });
  const list = h('div.card');
  const draw = () => {
    const q = norm(inp.value);
    foodFilter = inp.value;
    const arr = state.foods.filter((f) => (showArchived || !f.archived) && (!q || f.nameNorm.includes(q)))
      .sort((a, b) => a.nameNorm.localeCompare(b.nameNorm, 'de'));
    clear(list, arr.length ? arr.map((f) => h('div.list-row',
      h('button.star' + (f.favorite ? '.on' : ''), {
        'aria-label': 'Favorit', onclick: async () => { f.favorite = !f.favorite; await db.put('foods', f); draw(); },
      }, f.favorite ? '★' : '☆'),
      h('button.grow.plain', { onclick: () => openFoodEditor(f) },
        h('div.name', f.name, f.archived ? ' (archiviert)' : ''), h('div.sub', `${f.unit} · ${fmt(f.kcal)} kcal${macroStr(f)}`), f.note && h('div.hint', f.note))))
      : emptyState(state.foods.length ? 'Kein Treffer.' : 'Noch keine Lebensmittel. Sie entstehen beim Eintragen – oder hier:'));
  };
  inp.addEventListener('input', draw);
  draw();
  return [
    h('div.row.gap', inp, h('button.btn.primary', { onclick: () => openFoodEditor(null) }, '＋ Neu')),
    h('label.check.small', h('input', { type: 'checkbox', checked: showArchived, onchange: (e) => { showArchived = e.target.checked; draw(); } }), ' Archivierte zeigen'),
    h('p.hint', `${state.foods.length} Lebensmittel · ★ = Quick-Add auf „Heute"`),
    list,
  ];
}

function renderPhases() {
  const t = today();
  const act = activePhase(t);
  const sorted = [...state.phases].sort((a, b) => b.start.localeCompare(a.start));
  const card = (p) => {
    const tg = phaseTargets(p);
    return h('button.card.phase' + (p === act ? '.active' : ''), { onclick: () => openPhaseEditor(p) },
      h('div.card-head', h('span', p.name, p === act ? ' · aktiv' : ''), h('span.sub', `${labelShort(p.start)} – ${p.end ? labelShort(p.end) : 'offen'}`)),
      h('div.sub', `${fmt(p.kcal)} kcal · P ${fmt(tg.protein)} g · KH ${fmt(tg.carbs)} g · F ${fmt(tg.fat)} g`,
        p.targetWeight ? ` · Ziel ${fmt(p.targetWeight, 1)} kg` : ''),
      p.note && h('div.hint', p.note));
  };
  const live = sorted.filter((p) => !p.archived), arch = sorted.filter((p) => p.archived);
  return [
    h('button.btn.primary.block', { onclick: () => openPhaseEditor(null) }, '＋ Neue Phase'),
    !act && h('p.hint', 'Heute ist keine Phase aktiv – ohne Phase werden keine Ziele angezeigt.'),
    live.length ? live.map(card) : emptyState('Noch keine Phasen angelegt.'),
    arch.length > 0 && h('details', h('summary', `Archiviert (${arch.length})`), arch.map(card)),
  ];
}
