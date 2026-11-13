// app.js – Einstieg: DB öffnen, Einstellungen laden, Tabs/Navigation, Service Worker.
import * as db from './db.js';
import { state, onChange, loadCaches, today, nav } from './state.js';
import { h, clear, icon, toast, sheetOpen, closeTopSheet } from './ui.js';
import { renderToday, openAddMenu } from './today.js';
import { renderFood } from './food.js';
import { renderSport } from './sport.js';
import { renderLife } from './body.js';
import { renderAnalysis } from './analysis.js';
import { renderSettings } from './settings.js';
import { renderPlanner } from './planner.js';

const TABS = [
  { id: 'today', label: 'Heute', icon: 'today', render: renderToday },
  { id: 'food', label: 'Essen', icon: 'food', render: renderFood },
  { id: 'sport', label: 'Sport', icon: 'sport', render: renderSport },
  { id: 'life', label: 'Leben', icon: 'life', render: renderLife },
  { id: 'planner', label: 'Planer', icon: 'plan', render: renderPlanner },
  { id: 'analysis', label: 'Auswertung', icon: 'chart', render: renderAnalysis },
  // Einstellungen: kein eigener Tab (Platz in der Tab-Leiste), erreichbar über das Zahnrad auf Heute
  { id: 'settings', label: 'Einstellungen', icon: 'settings', render: renderSettings, hidden: true },
];
let current = 'today';
const main = document.getElementById('main');

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const tab = TABS.find((t) => t.id === current);
  const root = h('div.view');
  try { await tab.render(root); }
  catch (e) { console.error(e); clear(root, h('div.banner.warn', 'Fehler beim Anzeigen: ' + e.message)); }
  if (seq !== renderSeq) return; // veraltetes Rendering verwerfen
  const scroll = main.scrollTop;
  main.replaceChildren(root);
  main.scrollTop = scroll;
  for (const b of document.querySelectorAll('.tabbar button')) b.classList.toggle('on', b.dataset.tab === current);
}

function switchTab(id) {
  if (id === current) { main.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  current = id;
  main.scrollTop = 0;
  render();
}

async function init() {
  try {
    await db.openDB();
  } catch (e) {
    clear(main, h('div.banner.warn', 'Datenbank konnte nicht geöffnet werden: ' + e.message));
    return;
  }
  state.settings = await db.loadSettings();
  if (!(await db.getMeta('installId'))) {
    await db.setMeta('installId', db.uid());
    await db.setMeta('schemaVersion', db.SCHEMA_VERSION);
    await db.saveSettings(state.settings);
  }
  state.date = today();
  await loadCaches();

  // Dauerhaften Speicher anfragen (iOS gewährt das für Home-Bildschirm-Apps meist stillschweigend)
  navigator.storage?.persist?.().catch(() => {});

  const bar = document.querySelector('.tabbar');
  nav.go = switchTab;
  clear(bar, ...TABS.filter((t) => !t.hidden).map((t) => h('button', { 'data-tab': t.id, onclick: () => switchTab(t.id), 'aria-label': t.label }, icon(t.icon), h('span', t.label))));
  document.getElementById('fab').addEventListener('click', openAddMenu);

  onChange(render);
  await render();

  // Tageswechsel: Wenn die App über Nacht offen war, auf den neuen Tag springen.
  let lastToday = today();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const t = today();
    if (t !== lastToday) { if (state.date === lastToday) state.date = t; lastToday = t; render(); }
  });

  registerSW();
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./service-worker.js').then((reg) => {
    const ask = offerUpdate;
    if (reg.waiting) ask(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); });
    });
  }).catch((e) => console.warn('SW-Registrierung fehlgeschlagen', e));
  // Nur nach einem Update neu laden – nicht bei der Erstinstallation (clients.claim)
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
}

function offerUpdate(worker) {
  const t = document.getElementById('toast');
  clear(t, h('span', 'Neue Version verfügbar'), h('button.toast-btn', { onclick: () => worker.postMessage('skipWaiting') }, 'Aktualisieren'));
  t.classList.add('show');
}

// Zurück-Geste/Escape schließt oberstes Sheet
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen()) closeTopSheet(); });

init();
