// diary.js – Tagebuch: freie Gedanken zum Tag (ein Text pro Tag, Feld `days.note`).
// Speichert automatisch beim Tippen, damit beim Schließen oder App-Wechsel nichts verloren geht.
import * as db from './db.js';
import { state, changed, today } from './state.js';
import { h, clear, sheet, toast, emptyState } from './ui.js';
import { norm } from './stats.js';
import { labelDay, labelLong, isValidKey, addDays } from './dates.js';

export const MAX_LEN = 50000;
const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Schreibt den Text für einen Tag (leer = Tagebuchtext entfernen, Stimmung/Stress bleiben). */
async function saveText(date, text) {
  const rec = (await db.get('days', date)) || { date };
  rec.note = text.trim() ? text : null;
  if (rec.note == null && rec.mood == null && rec.stress == null && Object.keys(rec).every((k) => ['date', 'note', 'createdAt', 'updatedAt'].includes(k))) {
    await db.del('days', date);
  } else await db.put('days', rec);
}

export async function openDiarySheet(dateArg) {
  const date = dateArg || state.date || today();
  const rec = await db.get('days', date);
  const orig = rec?.note || '';
  let cleanup = null;
  sheet(`📓 ${labelLong(date)}`, () => {
    const ta = h('textarea.inp.diary', { placeholder: 'Gedanken zum Tag …', maxlength: MAX_LEN, autocapitalize: 'sentences' });
    ta.value = orig;
    const status = h('span.hint');
    let timer = null, dirty = false;
    const flush = async () => {
      clearTimeout(timer);
      if (!dirty) return;
      dirty = false;
      await saveText(date, ta.value);
      status.textContent = `${words(ta.value)} Wörter · gespeichert`;
    };
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(220, ta.scrollHeight + 4) + 'px'; };
    ta.addEventListener('input', () => {
      dirty = true; grow();
      status.textContent = `${words(ta.value)} Wörter · …`;
      clearTimeout(timer); timer = setTimeout(flush, 700);
    });
    ta.addEventListener('blur', flush);
    // Beim Wechsel in den Hintergrund sofort sichern
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    status.textContent = orig ? `${words(orig)} Wörter` : '';
    requestAnimationFrame(grow);
    const box = h('div', ta,
      h('div.row.between', status,
        h('button.btn.small.ghost', {
          onclick: async () => {
            if (!ta.value.trim()) return;
            const before = ta.value;
            ta.value = ''; dirty = true; await flush(); grow(); changed();
            toast('Tagebucheintrag gelöscht', { undo: async () => { ta.value = before; dirty = true; await flush(); grow(); changed(); } });
          },
        }, 'Leeren')));
    cleanup = async () => { document.removeEventListener('visibilitychange', onHide); await flush(); };
    return box;
  }, {
    tall: true,
    onClose: async () => {
      await cleanup?.();
      changed();
    },
  });
}

// --- Ansicht „Leben → Tagebuch" ------------------------------------------------------------------

let query = '';
export async function renderDiary() {
  const t = today();
  const all = (await db.all('days')).filter((d) => d.note && d.note.trim()).sort((a, b) => b.date.localeCompare(a.date));
  const q = h('input.inp.search', { type: 'search', placeholder: 'Im Tagebuch suchen …', value: query });
  const list = h('div');
  const pick = h('input.date-overlay', {
    type: 'date', max: t, 'aria-label': 'Tag wählen',
    onchange: (e) => { if (isValidKey(e.target.value)) openDiarySheet(e.target.value); },
  });
  const draw = () => {
    query = q.value;
    const nq = norm(query);
    const rows = nq ? all.filter((d) => norm(d.note).includes(nq)) : all;
    const streak = (() => { let n = 0, k = t; const set = new Set(all.map((d) => d.date)); if (!set.has(k)) k = addDays(k, -1); while (set.has(k)) { n++; k = addDays(k, -1); } return n; })();
    clear(list,
      h('p.hint', nq ? `${rows.length} Treffer` : `${all.length} Einträge${streak > 1 ? ` · ${streak} Tage in Folge` : ''}`),
      rows.length ? h('div.card', rows.slice(0, 200).map((d) => h('button.list-row', { onclick: () => openDiarySheet(d.date) },
        h('div.grow', h('div.name', labelDay(d.date, t)), h('div.sub.preview', d.note.trim().slice(0, 240))), h('span.chev', '›'))))
        : emptyState(nq ? 'Kein Treffer.' : 'Noch keine Einträge.'));
  };
  q.addEventListener('input', draw);
  draw();
  const todayHas = all.some((d) => d.date === t);
  return [
    h('div.row.gap',
      h('button.btn.primary.grow', { onclick: () => openDiarySheet(t) }, todayHas ? '📓 Weiterschreiben' : '📓 Heute schreiben'),
      h('div.btn.ghost.picker', 'Anderer Tag', pick)),
    q, list,
  ];
}
