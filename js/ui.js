// ui.js – kleine DOM-Helfer: Element-Fabrik, Bottom-Sheets, Toasts, Eingabe-Bausteine.

/** h('div.card#x', {onclick, …}, kinder…) */
export function h(tag, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    children.unshift(attrs); attrs = {};
  }
  const [, name, rest] = /^([a-z0-9-]+)?(.*)$/i.exec(tag);
  const el = document.createElement(name || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) m[1] === '.' ? el.classList.add(m[2]) : (el.id = m[2]);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el, ...kids) => { el.replaceChildren(); append(el, kids); return el; };

// --- Bottom-Sheet ------------------------------------------------------------

const stack = [];
/**
 * Öffnet ein Bottom-Sheet. build(close) liefert den Inhalt.
 * Rückgabe: { close, el }. onClose wird beim Schließen aufgerufen.
 */
export function sheet(title, build, { onClose, tall = false } = {}) {
  const root = document.getElementById('sheets');
  const back = h('div.sheet-back');
  const body = h('div.sheet-body');
  const panel = h('div.sheet' + (tall ? '.tall' : ''), { role: 'dialog', 'aria-label': title },
    h('div.sheet-grip'),
    h('div.sheet-head', h('h2', title), h('button.icon-btn', { 'aria-label': 'Schließen', onclick: () => close() }, '✕')),
    body);
  let closed = false;
  function close(result) {
    if (closed) return; closed = true;
    document.activeElement?.blur?.();
    panel.classList.remove('open'); back.classList.remove('open');
    setTimeout(() => { back.remove(); panel.remove(); }, 220);
    stack.splice(stack.indexOf(api), 1);
    onClose?.(result);
  }
  const api = { close, el: panel, body };
  stack.push(api);
  back.addEventListener('click', () => close());
  // Wischen am Griff/Kopf nach unten schließt
  let y0 = null;
  panel.querySelector('.sheet-head').addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  panel.querySelector('.sheet-grip').addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 70) close(); y0 = null; });
  append(body, [build(close, api)]);
  root.append(back, panel);
  requestAnimationFrame(() => { back.classList.add('open'); panel.classList.add('open'); });
  return api;
}
export const closeTopSheet = () => stack.at(-1)?.close();
export const sheetOpen = () => stack.length > 0;

/** Bestätigung als Bottom-Sheet. Promise<boolean>. */
export function confirmSheet(title, text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let val = false;
    sheet(title, (close) => h('div',
      h('p.muted', text),
      h('div.row.gap',
        h('button.btn.ghost.grow', { onclick: () => close() }, 'Abbrechen'),
        h('button.btn.grow' + (danger ? '.danger' : '.primary'), { onclick: () => { val = true; close(); } }, okLabel))),
    { onClose: () => resolve(val) });
  });
}

// --- Toast mit Undo ------------------------------------------------------------

let toastTimer = null;
export function toast(msg, { undo, ms = 6000 } = {}) {
  const t = document.getElementById('toast');
  clearTimeout(toastTimer);
  clear(t, h('span', msg), undo && h('button.toast-btn', {
    onclick: async () => { t.classList.remove('show'); await undo(); },
  }, 'Rückgängig'));
  t.classList.add('show');
  toastTimer = setTimeout(() => t.classList.remove('show'), undo ? ms : 2500);
}

// --- Eingabe-Bausteine --------------------------------------------------------

/** Tap-Leiste 1–10. onChange(v). Erneuter Tap auf gleichen Wert hebt Auswahl auf. */
export function scale10(value, onChange, { min = 1, max = 10 } = {}) {
  const wrap = h('div.scale10');
  let cur = value;
  const render = () => clear(wrap, ...Array.from({ length: max - min + 1 }, (_, i) => {
    const v = min + i;
    return h('button.sc' + (v === cur ? '.on' : ''), {
      type: 'button',
      onclick: () => { cur = cur === v ? null : v; render(); onChange(cur); },
    }, String(v));
  }));
  render();
  return wrap;
}

/** Segmentierte Auswahl. opts = [{id,label}] */
export function segmented(opts, value, onChange, cls = '') {
  const wrap = h('div.seg' + cls);
  let cur = value;
  const render = () => clear(wrap, ...opts.map((o) => h('button' + (o.id === cur ? '.on' : ''), {
    type: 'button', onclick: () => { cur = o.id; render(); onChange(cur); },
  }, o.label)));
  render();
  return wrap;
}

export function field(label, input, hint) {
  return h('label.field', h('span.field-label', label), input, hint && h('span.hint', hint));
}

/** Numerisches Feld mit deutschem Komma. */
export const numInput = (attrs = {}) => h('input.inp', { type: 'text', inputmode: 'decimal', autocomplete: 'off', ...attrs });
export const textInput = (attrs = {}) => h('input.inp', { type: 'text', autocomplete: 'off', autocapitalize: 'sentences', ...attrs });
export const dateInput = (value) => h('input.inp', { type: 'date', value, required: true });
export const timeInput = (value) => h('input.inp', { type: 'time', value });

/** Simple Autocomplete-Chips unter einem Textfeld. */
export function suggestChips(input, getOptions) {
  const box = h('div.chips');
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const opts = getOptions().filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q).slice(0, 8);
    clear(box, ...opts.map((o) => h('button.chip', { type: 'button', onclick: () => { input.value = o; render(); input.dispatchEvent(new Event('input')); } }, o)));
  };
  input.addEventListener('input', render);
  render();
  return box;
}

export function emptyState(text, action) {
  return h('div.empty', h('p', text), action);
}

/** Kleine SVG-Icons für die Tab-Bar (Strichgrafik, currentColor). */
const ICONS = {
  today: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  food: '<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 2-2 6 0 8v10"/>',
  sport: '<path d="M4 9v6M20 9v6M7 6v12M17 6v12M7 12h10"/>',
  life: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16l4-5 3 3 5-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
};
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico');
  s.innerHTML = ICONS[name];
  return s;
}
