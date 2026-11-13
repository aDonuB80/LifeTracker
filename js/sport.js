// sport.js – Laufen, Bouldern, Gym (inkl. Vorlagen, PRs, Pausen-Timer) und Tab „Sport".
import * as db from './db.js';
import { state, changed, today, saveSettings } from './state.js';
import { h, clear, sheet, toast, field, numInput, textInput, dateInput, scale10, segmented, confirmSheet, emptyState, suggestChips } from './ui.js';
import { parseNum, fmt, norm, pace, gymRecords, gymVolume, boulderCount } from './stats.js';
import { isValidKey, fmtHMS, parseHMS, labelDay, addDays, weekStart, weekday, labelShort } from './dates.js';

const err = (e) => toast(e.message || String(e));
const toStr = (n) => (n == null ? '' : String(n).replace('.', ','));
export const TYPE_LABEL = { run: 'Laufen', boulder: 'Bouldern', gym: 'Gym' };
const TYPE_ICON = { run: '🏃', boulder: '🧗', gym: '🏋️' };

async function deleteWorkout(w, close) {
  close?.();
  await db.del('workouts', w.id); changed();
  toast(`${TYPE_LABEL[w.type]} gelöscht`, { undo: async () => { await db.put('workouts', w, { touch: false }); changed(); } });
}

const scaleById = (id) => state.settings.gradeScales.find((s) => s.id === id) || state.settings.gradeScales[0];

/** Kurzbeschreibung einer Einheit für Listen. */
export function workoutSummary(w) {
  if (w.type === 'run') {
    const p = pace(w.distanceKm, w.durationSec);
    return `${fmt(w.distanceKm, 2)} km · ${fmtHMS(w.durationSec)}${p ? ` · ${fmtHMS(p)}/km` : ''}`;
  }
  if (w.type === 'boulder') {
    const top = [...(w.sends || [])].filter((s) => s.n > 0).pop();
    return `${w.hall || 'Halle ?'} · ${boulderCount(w)} Boulder${top ? ` · max ${top.grade}` : ''}`;
  }
  const sets = (w.items || []).reduce((s, it) => s + it.sets.length, 0);
  return `${w.templateName ? w.templateName + ' · ' : ''}${(w.items || []).length} ${(w.items || []).length === 1 ? 'Übung' : 'Übungen'} · ${sets} ${sets === 1 ? 'Satz' : 'Sätze'} · ${fmt(gymVolume(w))} kg`;
}

function footer(w, close, onSave) {
  return h('div.row.gap.sticky-actions',
    w.id && h('button.btn.ghost', { onclick: () => deleteWorkout(w, close) }, 'Löschen'),
    h('button.btn.primary.grow', { onclick: onSave }, 'Speichern'));
}

// --- Laufen ----------------------------------------------------------------------------

export function openRunSheet(w) {
  w = w || { type: 'run', date: state.date || today() };
  sheet('Lauf', (close) => {
    const d = dateInput(w.date);
    const dist = numInput({ value: toStr(w.distanceKm), placeholder: 'km' });
    const dur = h('input.inp', { type: 'text', inputmode: 'numeric', value: w.durationSec ? fmtHMS(w.durationSec) : '', placeholder: 'h:mm:ss oder mm:ss' });
    const hr = numInput({ value: toStr(w.avgHr), inputmode: 'numeric', placeholder: 'optional' });
    const route = textInput({ value: w.route || '', placeholder: 'Strecke / Notiz' });
    const out = h('div.calc');
    const upd = () => {
      const km = parseNum(dist.value), s = parseHMS(dur.value);
      clear(out, km > 0 && s > 0 ? `Pace ${fmtHMS(s / km)} /km · ${fmt(km / (s / 3600), 1)} km/h` : 'Pace: –');
    };
    dist.addEventListener('input', upd); dur.addEventListener('input', upd); upd();
    return h('div',
      h('div.grid2', field('Distanz (km)', dist), field('Dauer', dur)),
      out,
      h('div.grid2', field('Ø-Puls', hr), field('Datum', d)),
      field('Strecke / Notiz', route),
      footer(w, close, async () => {
        const km = parseNum(dist.value), s = parseHMS(dur.value), p = hr.value.trim() ? parseNum(hr.value) : null;
        if (!(km > 0 && km <= 300)) return toast('Distanz: 0–300 km.');
        if (!(s > 0 && s < 48 * 3600)) return toast('Dauer bitte als h:mm:ss, mm:ss oder Minuten.');
        if (p != null && !(p >= 30 && p <= 230)) return toast('Puls: 30–230.');
        if (!isValidKey(d.value)) return toast('Bitte ein gültiges Datum wählen.');
        Object.assign(w, { date: d.value, distanceKm: km, durationSec: s, durationMin: Math.round(s / 60), avgHr: p, route: route.value.trim() || null });
        await db.put('workouts', w);
        close(); changed(); toast('Lauf gespeichert');
      }));
  });
}

// --- Bouldern ------------------------------------------------------------------------------

export async function openBoulderSheet(w) {
  const prevHalls = [...new Set((await db.range('workouts', 'type_date', ['boulder', '0000'], ['boulder', '9999'])).sort((a, b) => b.date.localeCompare(a.date)).map((x) => x.hall).filter(Boolean))];
  w = w || { type: 'boulder', date: state.date || today(), hall: prevHalls[0] || '', scaleId: null, sends: [], feeling: null };
  sheet('Bouldern', (close) => {
    const S = state.settings;
    const hall = textInput({ value: w.hall || '', placeholder: 'Halle' });
    let scaleId = w.scaleId || S.hallScale[w.hall] || S.defaultScaleId;
    const counts = new Map((w.sends || []).map((s) => [s.grade, s.n]));
    const grid = h('div.grade-grid');
    const total = h('span.sub');
    const scaleSeg = h('div');
    const drawScale = () => clear(scaleSeg, segmented(S.gradeScales.map((s) => ({ id: s.id, label: s.name })), scaleId, (id) => { scaleId = id; drawGrid(); }, '.wrap'));
    const drawGrid = () => {
      const sc = scaleById(scaleId);
      clear(grid, ...sc.grades.map((g) => {
        const n = h('span.gcount', String(counts.get(g) || 0));
        const set = (v) => { counts.set(g, Math.max(0, v)); n.textContent = counts.get(g); cell.classList.toggle('on', counts.get(g) > 0); sum(); };
        const cell = h('div.gcell' + (counts.get(g) ? '.on' : ''),
          h('button.gbtn', { type: 'button', 'aria-label': `${g} minus`, onclick: () => set((counts.get(g) || 0) - 1) }, '−'),
          h('div.gmid', h('span.gname', g), n),
          h('button.gbtn', { type: 'button', 'aria-label': `${g} plus`, onclick: () => set((counts.get(g) || 0) + 1) }, '+'));
        return cell;
      }));
      sum();
    };
    const sum = () => { const sc = scaleById(scaleId); total.textContent = `${sc.grades.reduce((s, g) => s + (counts.get(g) || 0), 0)} Boulder`; };
    hall.addEventListener('change', () => { const sid = S.hallScale[hall.value.trim()]; if (sid && sid !== scaleId) { scaleId = sid; drawScale(); drawGrid(); } });
    drawScale(); drawGrid();
    const dur = numInput({ value: toStr(w.durationMin), inputmode: 'numeric', placeholder: 'min' });
    const d = dateInput(w.date);
    const note = textInput({ value: w.note || '', placeholder: 'optional' });
    let feeling = w.feeling;
    return h('div',
      field('Halle', hall), suggestChips(hall, () => prevHalls),
      h('div.field', h('span.field-label', 'Skala'), scaleSeg),
      h('div.row.between', h('span.field-label', 'Gekletterte Boulder'), total),
      grid,
      h('div.grid2', field('Dauer (min)', dur), field('Datum', d)),
      h('div.field', h('span.field-label', 'Gefühl'), scale10(feeling, (v) => { feeling = v; })),
      field('Notiz', note),
      footer(w, close, async () => {
        const sc = scaleById(scaleId);
        const m = dur.value.trim() ? parseNum(dur.value) : null;
        if (m != null && !(m > 0 && m <= 600)) return toast('Dauer: 1–600 min.');
        if (!isValidKey(d.value)) return toast('Bitte ein gültiges Datum wählen.');
        const sends = sc.grades.map((g) => ({ grade: g, n: counts.get(g) || 0 })).filter((s) => s.n > 0);
        const hallName = hall.value.trim();
        Object.assign(w, { date: d.value, hall: hallName || null, scaleId: sc.id, scaleName: sc.name, sends, durationMin: m, feeling, note: note.value.trim() || null });
        await db.put('workouts', w);
        if (hallName && S.hallScale[hallName] !== sc.id) { S.hallScale[hallName] = sc.id; await saveSettings(); }
        close(); changed(); toast(`Bouldern gespeichert (${boulderCount(w)} Boulder)`);
      }));
  }, { tall: true });
}

// --- Pausen-Timer ---------------------------------------------------------------------------

let timer = { end: 0, iv: null, ctx: null };
function beep() {
  try {
    const ctx = timer.ctx; if (!ctx) return;
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15;
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.15);
    });
  } catch { /* Ton optional */ }
  navigator.vibrate?.(300);
}
export function startTimer(sec) {
  try { timer.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); timer.ctx.resume?.(); } catch { /* ohne Ton */ }
  timer.end = Date.now() + sec * 1000;
  clearInterval(timer.iv);
  const el = document.getElementById('timer');
  const draw = () => {
    const left = Math.round((timer.end - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(timer.iv); beep();
      clear(el, h('span', 'Pause vorbei'), h('button.btn.small', { onclick: stopTimer }, 'OK'));
      el.classList.add('done');
      setTimeout(() => { if (Date.now() > timer.end + 8000) stopTimer(); }, 9000);
      return;
    }
    clear(el, h('span.timer-num', fmtHMS(left)),
      h('button.btn.small.ghost', { onclick: () => { timer.end += 15000; draw(); } }, '+15 s'),
      h('button.btn.small.ghost', { onclick: stopTimer }, 'Stopp'));
  };
  el.classList.remove('done'); el.classList.add('show');
  draw(); timer.iv = setInterval(draw, 250);
}
export function stopTimer() { clearInterval(timer.iv); document.getElementById('timer').classList.remove('show', 'done'); }

// --- Gym --------------------------------------------------------------------------------------

export async function openGymSheet(w, template) {
  const history = (await db.range('workouts', 'type_date', ['gym', '0000'], ['gym', '9999'])).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const templates = await db.all('templates');
  const isNew = !w;
  w = w ? structuredClone(w) : { type: 'gym', date: state.date || today(), items: [] };
  /** Letzte Sätze einer Übung (vor dem aktuellen Workout). */
  const lastSets = (exId) => {
    for (const hw of history) {
      if (hw.id === w.id) continue;
      const it = hw.items.find((i) => i.exerciseId === exId);
      if (it && it.sets.length) return { date: hw.date, sets: it.sets };
    }
    return null;
  };
  const addExercise = (ex) => {
    const last = lastSets(ex.id);
    // vorbefüllt mit den letzten Werten
    w.items.push({ exerciseId: ex.id, nameSnap: ex.name, bodyweight: !!ex.bodyweight, sets: last ? last.sets.map((s) => ({ ...s })) : [{ reps: null, kg: null }] });
  };
  if (isNew && template) {
    w.templateId = template.id; w.templateName = template.name;
    for (const id of template.exerciseIds) { const ex = state.exercises.find((e) => e.id === id); if (ex) addExercise(ex); }
  }

  sheet('Gym', (close) => {
    const itemsBox = h('div');
    const drawItems = () => clear(itemsBox, w.items.length ? w.items.map((it, idx) => {
      const last = lastSets(it.exerciseId);
      const setsBox = h('div.sets');
      const drawSets = () => clear(setsBox,
        h('div.set-row.head', h('span', '#'), h('span', 'Wdh.'), h('span', it.bodyweight ? '+kg' : 'kg'), h('span')),
        it.sets.map((s, si) => h('div.set-row',
          h('span.sub', String(si + 1)),
          numInput({ value: toStr(s.reps), inputmode: 'numeric', 'aria-label': 'Wiederholungen', oninput: (e) => { s.reps = parseNum(e.target.value); } }),
          numInput({ value: toStr(s.kg), 'aria-label': 'Gewicht', oninput: (e) => { s.kg = parseNum(e.target.value); } }),
          h('button.icon-btn', { type: 'button', 'aria-label': 'Satz löschen', onclick: () => { it.sets.splice(si, 1); drawSets(); } }, '✕'))),
        h('div.row.gap',
          h('button.btn.small.ghost', { type: 'button', onclick: () => { const p = it.sets.at(-1); it.sets.push({ reps: p?.reps ?? null, kg: p?.kg ?? null }); drawSets(); } }, '＋ Satz'),
          h('div.grow'),
          h('button.btn.small.ghost', { type: 'button', 'aria-label': 'nach oben', disabled: idx === 0, onclick: () => { [w.items[idx - 1], w.items[idx]] = [w.items[idx], w.items[idx - 1]]; drawItems(); } }, '↑'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => { w.items.splice(idx, 1); drawItems(); } }, 'Entfernen')));
      drawSets();
      return h('div.card.ex',
        h('div.card-head', h('span', it.nameSnap)),
        it.note && h('div.hint', it.note),
        it.sets.some((s) => s.repsRaw != null && String(s.repsRaw) !== String(s.reps)) && h('div.hint', 'Original: ' + it.sets.map((s) => s.repsRaw ?? s.reps).join(', ')),
        last && h('div.sub', `Zuletzt ${labelShort(last.date)}: ${last.sets.map((s) => `${s.reps ?? '?'}×${fmt(s.kg || 0, s.kg % 1 ? 1 : 0)}`).join(', ')}`),
        setsBox);
    }) : h('p.muted', 'Übung hinzufügen – Vorlage oben wählen oder suchen.'));

    // Übungssuche mit On-the-fly-Anlage
    const q = h('input.inp.search', { type: 'search', placeholder: 'Übung suchen oder anlegen …', autocomplete: 'off' });
    const res = h('div.list');
    const drawRes = () => {
      const nq = norm(q.value);
      if (!nq) return clear(res);
      const hits = state.exercises.filter((e) => !e.archived && e.nameNorm.includes(nq)).slice(0, 8);
      const create = async (bw) => {
        const ex = await db.put('exercises', { name: q.value.trim(), nameNorm: nq, bodyweight: bw, archived: false });
        state.exercises.push(ex); addExercise(ex); q.value = ''; drawRes(); drawItems();
      };
      clear(res, hits.map((e) => h('button.list-row', { type: 'button', onclick: () => { addExercise(e); q.value = ''; drawRes(); drawItems(); } }, h('span.grow', e.name), h('span.chev', '＋'))),
        !hits.some((e) => e.nameNorm === nq) && h('div.row.gap',
          h('button.list-row.create.grow', { type: 'button', onclick: () => create(false) }, h('span.plus', '＋'), `„${q.value.trim()}" anlegen`),
          h('button.btn.small.ghost', { type: 'button', onclick: () => create(true) }, 'als Körpergewicht')));
    };
    q.addEventListener('input', drawRes);
    drawItems();

    const tplChips = isNew && templates.length > 0 && h('div.chips', templates.map((t) => h('button.chip', {
      type: 'button',
      onclick: () => {
        w.templateId = t.id; w.templateName = t.name;
        for (const id of t.exerciseIds) { const ex = state.exercises.find((e) => e.id === id); if (ex && !w.items.some((i) => i.exerciseId === id)) addExercise(ex); }
        drawItems();
      },
    }, '📋 ' + t.name)));
    const d = dateInput(w.date);
    const dur = numInput({ value: toStr(w.durationMin), inputmode: 'numeric', placeholder: 'min' });
    const note = textInput({ value: w.note || '', placeholder: 'optional' });
    const timerRow = h('div.chips', h('span.sub', 'Pause:'), state.settings.restPresets.map((s) => h('button.chip', { type: 'button', onclick: () => startTimer(s) }, fmtHMS(s))));

    return h('div',
      tplChips,
      itemsBox,
      q, res,
      timerRow,
      h('div.grid2', field('Dauer (min)', dur), field('Datum', d)),
      field('Notiz', note),
      h('button.btn.ghost.block', {
        type: 'button',
        onclick: () => {
          if (!w.items.length) return toast('Erst Übungen hinzufügen.');
          sheet('Als Vorlage speichern', (c2) => {
            const n = textInput({ value: w.templateName || '', placeholder: 'z. B. Push, Ganzkörper A' });
            return h('div', field('Name', n), h('button.btn.primary.block', {
              onclick: async () => {
                if (!n.value.trim()) return toast('Bitte einen Namen eingeben.');
                const t = await db.put('templates', { name: n.value.trim(), exerciseIds: w.items.map((i) => i.exerciseId) });
                w.templateId = t.id; w.templateName = t.name; c2(); toast('Vorlage gespeichert');
              },
            }, 'Speichern'));
          });
        },
      }, 'Als Vorlage speichern'),
      footer(w, close, async () => {
        try {
          if (!isValidKey(d.value)) throw new Error('Bitte ein gültiges Datum wählen.');
          const m = dur.value.trim() ? parseNum(dur.value) : null;
          if (m != null && !(m > 0 && m <= 600)) throw new Error('Dauer: 1–600 min.');
          for (const it of w.items) {
            it.sets = it.sets.filter((s) => s.reps != null || s.kg != null);
            for (const s of it.sets) {
              if (!(Number.isInteger(s.reps) && s.reps > 0 && s.reps <= 200)) throw new Error(`${it.nameSnap}: Wiederholungen als ganze Zahl 1–200.`);
              s.kg = s.kg ?? 0;
              if (!(s.kg >= 0 && s.kg <= 1000)) throw new Error(`${it.nameSnap}: Gewicht 0–1000 kg.`);
            }
          }
          w.items = w.items.filter((it) => it.sets.length);
          if (!w.items.length) throw new Error('Keine Sätze eingetragen.');
          Object.assign(w, { date: d.value, durationMin: m, note: note.value.trim() || null });
          // PR-Erkennung: Bestwerte vorher vs. nachher
          const before = gymRecords(history.filter((x) => x.id !== w.id));
          const after = gymRecords([w]);
          const prs = [];
          for (const [id, r] of after) {
            const b = before.get(id);
            if (!b) continue; // erste Einheit ist kein PR
            if (r.maxKg > b.maxKg) prs.push(`${r.name}: ${fmt(r.maxKg, 1)} kg`);
            else if (r.maxE1rm > b.maxE1rm + 0.01) prs.push(`${r.name}: e1RM ${fmt(r.maxE1rm, 1)} kg`);
          }
          await db.put('workouts', w);
          close(); changed();
          toast(prs.length ? `🏆 Neuer PR – ${prs.join(' · ')}` : 'Training gespeichert');
        } catch (x) { err(x); }
      }));
  }, { tall: true });
}

export const openWorkout = (w) => (w.type === 'run' ? openRunSheet(w) : w.type === 'boulder' ? openBoulderSheet(w) : openGymSheet(w));

// --- Tab „Sport" ---------------------------------------------------------------------------------

let sub = 'list';
export async function renderSport(root) {
  const seg = segmented([{ id: 'list', label: 'Einheiten' }, { id: 'records', label: 'Rekorde' }, { id: 'templates', label: 'Vorlagen' }], sub, (s) => { sub = s; changed(); }, '.top');
  const t = today();
  const addRow = h('div.grid3',
    h('button.btn.tile', { onclick: () => openRunSheet() }, '🏃', h('span', 'Lauf')),
    h('button.btn.tile', { onclick: () => openBoulderSheet() }, '🧗', h('span', 'Bouldern')),
    h('button.btn.tile', { onclick: () => openGymSheet() }, '🏋️', h('span', 'Gym')));

  if (sub === 'records') {
    const rec = gymRecords(await db.range('workouts', 'type_date', ['gym', '0000'], ['gym', '9999']));
    const arr = [...rec.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return clear(root, seg, arr.length ? h('div.card', arr.map((r) => h('div.list-row',
      h('div.grow', h('div.name', r.name), h('div.sub', `max ${fmt(r.maxKg, 1)} kg (${labelShort(r.date.maxKg)}) · ${r.maxReps} Wdh. max`)),
      h('div.num', `e1RM ${fmt(r.maxE1rm, 1)}`))))
      : emptyState('Noch keine Gym-Einheiten.'));
  }
  if (sub === 'templates') {
    const tpls = await db.all('templates');
    return clear(root, seg, h('p.hint', 'Vorlagen entstehen im Gym-Sheet über „Als Vorlage speichern".'),
      tpls.length ? h('div.card', tpls.map((tp) => h('div.list-row',
        h('button.grow.plain', { onclick: () => openGymSheet(null, tp) }, h('div.name', tp.name),
          h('div.sub', tp.exerciseIds.map((id) => state.exercises.find((e) => e.id === id)?.name || '?').join(', '))),
        h('button.icon-btn', {
          'aria-label': 'Vorlage löschen',
          onclick: async () => {
            if (!(await confirmSheet('Vorlage löschen?', tp.name, 'Löschen', true))) return;
            await db.del('templates', tp.id); changed();
            toast('Vorlage gelöscht', { undo: async () => { await db.put('templates', tp, { touch: false }); changed(); } });
          },
        }, '✕')))) : emptyState('Keine Vorlagen.'));
  }

  // Einheiten: Wochenleiste + Liste der letzten 12 Wochen
  const from = addDays(weekStart(t), -7 * 11);
  const ws = (await db.range('workouts', 'date', from, t)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const wk0 = weekStart(t);
  const strip = h('div.weekstrip', Array.from({ length: 7 }, (_, i) => {
    const k = addDays(wk0, i);
    const dayW = ws.filter((w) => w.date === k);
    return h('div.wday' + (k === t ? '.today' : ''), h('span.sub', ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][i]),
      h('span.dots', dayW.map((w) => TYPE_ICON[w.type]).join('') || '·'));
  }));
  const thisWeek = ws.filter((w) => w.date >= wk0).length;
  const groups = new Map();
  for (const w of ws) { const k = weekStart(w.date); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); }
  return clear(root, seg, addRow,
    h('div.card', h('div.card-head', h('span', 'Wochenübersicht'), h('span.sub', `${thisWeek} ${thisWeek === 1 ? 'Einheit' : 'Einheiten'}`)), strip),
    groups.size ? [...groups].map(([k, arr]) => h('div.card',
      h('div.card-head', h('span', k === wk0 ? 'Diese Woche' : `Woche ab ${labelShort(k)}`), h('span.sub', `${arr.length}×`)),
      arr.map((w) => h('button.list-row', { onclick: () => openWorkout(w) },
        h('span.ticon', TYPE_ICON[w.type]),
        h('div.grow', h('div.name', `${TYPE_LABEL[w.type]} · ${labelDay(w.date, t)}`), h('div.sub', workoutSummary(w))),
        h('span.chev', '›')))))
      : emptyState('Noch keine Einheiten in den letzten 12 Wochen.'));
}
