// charts.js – schlanker SVG-Zeitreihen-Chart mit Touch-Fadenkreuz (ohne Bibliothek).
import { diffDays, addDays, labelShort, parseKey } from './dates.js';
import { fmt } from './stats.js';
import { h } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/**
 * timeChart({ from, to, series, hlines, digits, tooltip })
 * series: [{ kind:'points'|'line'|'band', cls, data:[{k, y}] | [{k, lo, hi}], dashed }]
 * tooltip(k) → String für den Fadenkreuz-Tag.
 */
export function timeChart({ from, to, series, hlines = [], digits = 1, tooltip, yMin, yMax, yFmt }) {
  const W = 360, H = 230, L = 36, R = 8, T = 10, B = 24;
  const span = Math.max(1, diffDays(from, to));
  const x = (k) => L + (diffDays(from, k) / span) * (W - L - R);

  let lo = Infinity, hi = -Infinity;
  for (const se of series) for (const p of se.data) {
    for (const v of se.kind === 'band' ? [p.lo, p.hi] : [p.y]) if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  for (const hl of hlines) { lo = Math.min(lo, hl.y); hi = Math.max(hi, hl.y); }
  if (!isFinite(lo)) return h('div.empty', h('p', 'Keine Daten im Zeitraum.'));
  const pad = Math.max(0.5, (hi - lo) * 0.08);
  lo -= pad; hi += pad;
  if (yMin != null) lo = yMin;
  if (yMax != null) hi = yMax;
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  // Y-Raster
  const step = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
    const t = s('text', { x: L - 4, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }); t.textContent = yFmt ? yFmt(v) : fmt(v, step < 1 ? 1 : 0); svg.append(t);
  }
  // X-Beschriftung: ~4 Ticks
  for (let i = 0; i <= 3; i++) {
    const k = addDays(from, Math.round((span * i) / 3));
    const t = s('text', { x: x(k), y: H - 6, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === 3 ? 'end' : 'middle' });
    const { d, m, y: yy } = parseKey(k);
    t.textContent = span > 400 ? `${String(m).padStart(2, '0')}/${String(yy).slice(2)}` : `${d}.${m}.`;
    svg.append(t);
  }
  for (const hl of hlines) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(hl.y), y2: y(hl.y), class: 'hline ' + (hl.cls || '') }));
    const t = s('text', { x: W - R - 2, y: y(hl.y) - 3, class: 'axis hl-label', 'text-anchor': 'end' }); t.textContent = hl.label; svg.append(t);
  }
  for (const se of series) {
    const pts = se.data.filter((p) => p.k >= from && p.k <= to);
    if (se.kind === 'band' && pts.length > 1) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.k)},${y(p.hi)}`).join('') + [...pts].reverse().map((p) => `L${x(p.k)},${y(p.lo)}`).join('') + 'Z';
      svg.append(s('path', { d, class: 'band ' + (se.cls || '') }));
    } else if (se.kind === 'line') {
      // Lücken (y=null) unterbrechen die Linie
      let d = '', pen = false;
      for (const p of pts) { if (p.y == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(p.k).toFixed(1)},${y(p.y).toFixed(1)}`; pen = true; }
      if (d) svg.append(s('path', { d, class: 'line ' + (se.cls || ''), ...(se.dashed ? { 'stroke-dasharray': '5 4' } : {}) }));
    } else if (se.kind === 'points') {
      const r = pts.length > 200 ? 1.4 : 2.4;
      for (const p of pts) svg.append(s('circle', { cx: x(p.k), cy: y(p.y), r, class: 'pt ' + (se.cls || '') }));
    }
  }
  // Fadenkreuz
  const cross = s('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
  svg.append(cross);
  const tip = h('div.chart-tip');
  const wrap = h('div.chart-wrap', svg, tip);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const frac = Math.min(1, Math.max(0, (px - L) / (W - L - R)));
    const k = addDays(from, Math.round(frac * span));
    cross.setAttribute('x1', x(k)); cross.setAttribute('x2', x(k)); cross.setAttribute('visibility', 'visible');
    tip.textContent = `${labelShort(k)} · ${tooltip ? tooltip(k) : ''}`;
    tip.classList.add('show');
  };
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.classList.remove('show'); });
  return wrap;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

/**
 * barChart({ labels, stacks:[{cls, values}], targets?, tooltip(i) })
 * Gestapelte Balken; targets = optionale Zielmarke pro Balken.
 */
export function barChart({ labels, stacks, targets, tooltip, height = 170 }) {
  const W = 360, H = height, L = 34, R = 6, T = 8, B = 20;
  const n = labels.length;
  if (!n) return h('div.empty', h('p', 'Keine Daten im Zeitraum.'));
  const tot = labels.map((_, i) => stacks.reduce((s, st) => s + (st.values[i] || 0), 0));
  const max = Math.max(1e-9, ...tot, ...(targets || []).filter((x) => x != null));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const bw = (W - L - R) / n;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
    const t = s('text', { x: L - 4, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }); t.textContent = fmt(v, step < 1 ? 1 : 0); svg.append(t);
  }
  const every = Math.ceil(n / 8);
  labels.forEach((lb, i) => {
    let acc = 0;
    const x = L + i * bw + bw * 0.15, w = Math.max(1, bw * 0.7);
    for (const st of stacks) {
      const v = st.values[i] || 0;
      if (v > 0) svg.append(s('rect', { x, width: w, y: y(acc + v), height: Math.max(0.5, y(acc) - y(acc + v)), rx: Math.min(3, w / 3), class: 'bar ' + (st.cls || '') }));
      acc += v;
    }
    if (targets && targets[i] != null) svg.append(s('line', { x1: x - 1, x2: x + w + 1, y1: y(targets[i]), y2: y(targets[i]), class: 'tgt' }));
    if (i % every === 0) { const t = s('text', { x: x + w / 2, y: H - 6, class: 'axis', 'text-anchor': 'middle' }); t.textContent = lb; svg.append(t); }
  });
  const hl = s('rect', { y: T, height: H - T - B, width: bw, class: 'bar-hl', visibility: 'hidden' });
  svg.append(hl);
  const tip = h('div.chart-tip');
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor(((((ev.clientX - r.left) / r.width) * W) - L) / bw)));
    hl.setAttribute('x', L + i * bw); hl.setAttribute('visibility', 'visible');
    tip.textContent = tooltip ? tooltip(i) : `${labels[i]}: ${fmt(tot[i])}`;
    tip.classList.add('show');
  };
  svg.addEventListener('pointerdown', move); svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { hl.setAttribute('visibility', 'hidden'); tip.classList.remove('show'); });
  return h('div.chart-wrap', svg, tip);
}
