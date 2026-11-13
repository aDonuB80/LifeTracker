// body.js – Gewicht, Schlaf, Stimmung/Stress: Erfassungs-Sheets und Tab „Leben".
import * as db from './db.js';
import { state, changed, today } from './state.js';
import { h, clear, sheet, toast, field, numInput, textInput, dateInput, timeInput, scale10, segmented, emptyState } from './ui.js';
import { parseNum, fmt } from './stats.js';
import { renderEvents, renderStars } from './social.js';
import { renderDiary, openDiarySheet } from './diary.js';
import { isValidKey, parseTime, wallToTs, timeOf, sleepTimestamps, fmtDuration, labelDay, berlinParts, addDays } from './dates.js';

const nowTime = () => { const p = berlinParts(); return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`; };

// --- Gewicht ---------------------------------------------------------------------

export async function lastWeight() {
  const all = await db.range('weights', 'date', addDays(today(), -60), today());
  return all.sort((a, b) => b.ts - a.ts)[0] || null;
}

export async function openWeightSheet(existing) {
  const last = existing || (await lastWeight());
  const date = existing?.date || state.date || today();
  sheet(existing ? 'Gewicht bearbeiten' : 'Gewicht eintragen', (close) => {
    const kg = numInput({ value: last ? String(last.kg).replace('.', ',') : '', placeholder: 'kg', class: 'huge' });
    const d = dateInput(date);
    const t = timeInput(existing ? timeOf(existing.ts) : nowTime());
    kg.addEventListener('focus', () => kg.select());
    const save = async () => {
      const v = parseNum(kg.value);
      if (!(v >= 30 && v <= 300)) return toast('Gewicht: 30–300 kg.');
      if (!isValidKey(d.value)) return toast('Bitte ein gültiges Datum wählen.');
      const tm = parseTime(t.value) || { hh: 12, mm: 0 };
      const rec = { ...(existing || {}), date: d.value, kg: Math.round(v * 10) / 10, ts: wallToTs(d.value, tm.hh, tm.mm) };
      const saved = await db.put('weights', rec);
      close(); changed();
      if (!existing) toast(`${fmt(saved.kg, 1)} kg gespeichert`, { undo: async () => { await db.del('weights', saved.id); changed(); } });
    };
    kg.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    return h('div',
      h('div.row.center', kg, h('span.unit', 'kg')),
      h('div.chips.center', [-0.5, -0.1, 0.1, 0.5].map((dlt) => h('button.chip', {
        type: 'button', onclick: () => { const v = parseNum(kg.value) || 0; kg.value = String(Math.round((v + dlt) * 10) / 10).replace('.', ','); },
      }, (dlt > 0 ? '+' : '−') + String(Math.abs(dlt)).replace('.', ',')))),
      h('div.grid2', field('Datum', d), field('Uhrzeit', t)),
      h('div.row.gap.sticky-actions',
        existing && h('button.btn.ghost', {
          onclick: async () => { close(); await db.del('weights', existing.id); changed(); toast('Messung gelöscht', { undo: async () => { await db.put('weights', existing, { touch: false }); changed(); } }); },
        }, 'Löschen'),
        h('button.btn.primary.grow', { onclick: save }, 'Speichern')));
  });
}

// --- Schlaf ------------------------------------------------------------------------

export async function openSleepSheet(existing) {
  const date = existing?.date || state.date || today();
  const prev = existing || (await db.range('sleep', 'date', date))[0] || null;
  const lastAny = prev || (await db.range('sleep', 'date', addDays(date, -14), date)).sort((a, b) => b.wakeTs - a.wakeTs)[0];
  const day = (await db.get('days', date)) || { date };
  sheet('Schlaf & Befinden', (close) => {
    const d = dateInput(date);
    const bed = timeInput(lastAny ? timeOf(lastAny.bedTs) : '23:00');
    const wake = timeInput(lastAny ? timeOf(lastAny.wakeTs) : '07:00');
    let quality = prev?.quality ?? null, mood = day.mood ?? null;
    const note = textInput({ value: prev?.note || '', placeholder: 'optional' });
    const dur = h('div.calc');
    const upd = () => {
      const b = parseTime(bed.value), w = parseTime(wake.value);
      if (!b || !w || !isValidKey(d.value)) return clear(dur, '–');
      clear(dur, '= ', fmtDuration(sleepTimestamps(d.value, b, w, state.settings.dayStartHour).durationMin));
    };
    for (const el of [bed, wake, d]) el.addEventListener('input', upd);
    upd();
    return h('div',
      field('Aufwachtag', d, 'Die Nacht zählt zum Tag des Aufwachens.'),
      h('div.grid2', field('Eingeschlafen', bed), field('Aufgewacht', wake)),
      dur,
      h('div.field', h('span.field-label', 'Schlafqualität'), scale10(quality, (v) => { quality = v; })),
      h('div.field', h('span.field-label', 'Stimmung heute'), scale10(mood, (v) => { mood = v; })),
      field('Notiz', note),
      h('div.row.gap.sticky-actions',
        prev && h('button.btn.ghost', {
          onclick: async () => { close(); await db.del('sleep', prev.id); changed(); toast('Schlafeintrag gelöscht', { undo: async () => { await db.put('sleep', prev, { touch: false }); changed(); } }); },
        }, 'Löschen'),
        h('button.btn.primary.grow', {
          onclick: async () => {
            const b = parseTime(bed.value), w = parseTime(wake.value);
            if (!isValidKey(d.value)) return toast('Bitte ein gültiges Datum wählen.');
            if (!b || !w) return toast('Bitte beide Uhrzeiten angeben.');
            const s = sleepTimestamps(d.value, b, w, state.settings.dayStartHour);
            if (s.durationMin < 15 || s.durationMin > 20 * 60) return toast('Schlafdauer unplausibel (15 min – 20 h).');
            // ein Eintrag pro Nacht: vorhandenen Eintrag des Zieldatums überschreiben
            const target = d.value === prev?.date ? prev : (await db.range('sleep', 'date', d.value))[0];
            await db.put('sleep', { ...(target || {}), date: d.value, bedTs: s.bedTs, wakeTs: s.wakeTs, durationMin: s.durationMin, quality, note: note.value.trim() || null });
            if (mood != null || day.mood != null) {
              const dd = (await db.get('days', d.value)) || { date: d.value };
              dd.mood = mood;
              await db.put('days', dd);
            }
            close(); changed(); toast(`Schlaf ${fmtDuration(s.durationMin)} gespeichert`);
          },
        }, 'Speichern')));
  }, { tall: true });
}

// --- Stimmung & Stress -----------------------------------------------------------------

export async function openMoodSheet(dateArg) {
  const date = dateArg || state.date || today();
  const day = (await db.get('days', date)) || { date };
  sheet('Stimmung & Stress', (close) => {
    const d = dateInput(date);
    let mood = day.mood ?? null, stress = day.stress ?? null;
    return h('div',
      h('div.field', h('span.field-label', 'Stimmung (1 = mies, 10 = super)'), scale10(mood, (v) => { mood = v; })),
      h('div.field', h('span.field-label', 'Stress (1 = entspannt, 10 = maximal)'), scale10(stress, (v) => { stress = v; })),
      h('button.btn.ghost.block', { type: 'button', onclick: () => openDiarySheet(date) }, day.note ? '📓 Tagebuch zum Tag öffnen' : '📓 Gedanken zum Tag ins Tagebuch'),
      field('Datum', d),
      h('button.btn.primary.block.sticky-actions', {
        onclick: async () => {
          if (!isValidKey(d.value)) return toast('Bitte ein gültiges Datum wählen.');
          // frisch lesen – das Tagebuch kann den Datensatz inzwischen geändert haben
          const rec = (await db.get('days', d.value)) || { date: d.value };
          Object.assign(rec, { mood, stress });
          await db.put('days', rec);
          close(); changed(); toast('Gespeichert');
        },
      }, 'Speichern'));
  });
}

// --- Tab „Leben" (MVP: Schlaf + Befinden) ----------------------------------------------

let sub = 'sleep';
export async function renderLife(root) {
  const seg = segmented([{ id: 'sleep', label: 'Schlaf' }, { id: 'mood', label: 'Befinden' }, { id: 'diary', label: 'Tagebuch' }, { id: 'social', label: 'Ereignisse' }, { id: 'star', label: '⭐' }], sub, (s) => { sub = s; changed(); }, '.top');
  const t = today(), from = addDays(t, -59);
  if (sub === 'sleep') {
    const rows = (await db.range('sleep', 'date', from, t)).sort((a, b) => b.date.localeCompare(a.date));
    return clear(root, seg,
      h('button.btn.primary.block', { onclick: () => openSleepSheet() }, '＋ Schlaf eintragen'),
      rows.length ? h('div.card', rows.map((s) => h('button.list-row', { onclick: () => openSleepSheet(s) },
        h('div.grow', h('div.name', labelDay(s.date, t)), h('div.sub', `${timeOf(s.bedTs)} – ${timeOf(s.wakeTs)}${s.note ? ' · ' + s.note : ''}`)),
        h('div.num', fmtDuration(s.durationMin), s.quality ? h('div.sub', `Q ${s.quality}`) : ''))))
        : emptyState('Noch keine Schlafeinträge.'));
  }
  if (sub === 'mood') {
    const rows = (await db.range('days', null, from, t)).filter((d) => d.mood != null || d.stress != null).sort((a, b) => b.date.localeCompare(a.date));
    return clear(root, seg,
      h('button.btn.primary.block', { onclick: () => openMoodSheet() }, '＋ Stimmung/Stress eintragen'),
      rows.length ? h('div.card', rows.map((d) => h('button.list-row', { onclick: () => openMoodSheet(d.date) },
        h('div.grow', h('div.name', labelDay(d.date, t)), d.note && h('div.sub', '📓')),
        h('div.num', `🙂 ${d.mood ?? '–'} · Stress ${d.stress ?? '–'}`))))
        : emptyState('Noch keine Einträge.'));
  }
  if (sub === 'diary') return clear(root, seg, ...(await renderDiary()));
  if (sub === 'star') return clear(root, seg, ...(await renderStars()));
  return clear(root, seg, ...(await renderEvents()));
}
