// db.js – IndexedDB-Zugriff mit versionierten Migrationen.
// IndexedDB-Version == Schema-Version. Jede Migration läuft genau einmal in onupgradeneeded.

export const DB_NAME = 'lifetrack';
export const SCHEMA_VERSION = 2;

/** Alle Daten-Stores (für Export/Import). `meta` ist separat. */
export const STORES = [
  'foods', 'foodLog', 'phases', 'weights', 'workouts', 'exercises', 'templates',
  'sleep', 'days', 'people', 'events', 'sz', 'appointments', 'todos',
];
/** Stores, deren Schlüssel nicht `id` ist. */
export const KEY_OF = { days: 'date', meta: 'key' };

/**
 * Migrationen: MIGRATIONS[n] hebt die DB von Version n-1 auf n.
 * Neue Felder/Stores immer hier ergänzen, nie bestehende Migrationen ändern.
 */
const MIGRATIONS = {
  1(db) {
    db.createObjectStore('meta', { keyPath: 'key' });
    const s = (name, idx = [], keyPath = 'id') => {
      const st = db.createObjectStore(name, { keyPath });
      for (const i of idx) st.createIndex(Array.isArray(i) ? i.join('_') : i, i);
    };
    s('foods', ['nameNorm', 'lastUsedAt', 'favorite']);
    s('foodLog', ['date', 'foodId']);
    s('phases', ['start']);
    s('weights', ['date']);
    s('workouts', ['date', 'type', ['type', 'date']]);
    s('exercises', ['nameNorm']);
    s('templates');
    s('sleep', ['date']);
    s('days', [], 'date');
    s('people');
    s('events', ['date', 'typeNorm']);
    s('sz', ['date']);
  },
  // v2 (0.4.0): Termine und Todos
  2(db) {
    db.createObjectStore('appointments', { keyPath: 'id' }).createIndex('date', 'date');
    db.createObjectStore('todos', { keyPath: 'id' }).createIndex('due', 'due');
  },
};

/** Datensatz-Migrationen für importierte Exporte älterer Schema-Versionen. */
export const RECORD_MIGRATIONS = {
  // v1 → v2: neue Stores, bestehende Datensätze unverändert
  2: (data) => { data.appointments ||= []; data.todos ||= []; },
};

let dbp = null;
export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion + 1; v <= SCHEMA_VERSION; v++) MIGRATIONS[v](db, req.transaction);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Datenbank blockiert – bitte andere Tabs der App schließen.'));
  });
  return dbp;
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('abgebrochen')); });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

/** Speichert (insert/update), setzt id/createdAt/updatedAt. Gibt den Datensatz zurück. */
export async function put(store, obj, { touch = true } = {}) {
  const db = await openDB();
  const now = Date.now();
  const kp = KEY_OF[store] || 'id';
  if (kp === 'id' && !obj.id) obj.id = uid();
  if (!obj.createdAt) obj.createdAt = now;
  if (touch || !obj.updatedAt) obj.updatedAt = now;
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(obj);
  await done(tx);
  return obj;
}

export async function putMany(store, arr) {
  if (!arr.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const st = tx.objectStore(store);
  for (const o of arr) st.put(o);
  await done(tx);
}

export async function get(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}

export async function del(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await done(tx);
}

export async function all(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

/** Alle Datensätze mit index ∈ [lo, hi] (inklusive). hi optional = lo. */
export async function range(store, index, lo, hi = lo) {
  const db = await openDB();
  const st = db.transaction(store).objectStore(store);
  const src = index ? st.index(index) : st;
  return wrap(src.getAll(IDBKeyRange.bound(lo, hi)));
}

export async function clearAll() {
  const db = await openDB();
  const tx = db.transaction([...STORES], 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await done(tx);
}

/** Schreibt mehrere Stores in einer Transaktion (Import). mode 'replace' leert vorher. */
export async function bulkWrite(data, mode) {
  const db = await openDB();
  const tx = db.transaction([...STORES], 'readwrite');
  for (const s of STORES) {
    const st = tx.objectStore(s);
    if (mode === 'replace') st.clear();
    for (const o of data[s] || []) st.put(o);
  }
  await done(tx);
}

// --- meta / Einstellungen -------------------------------------------------

export const DEFAULT_SCALES = [
  { id: 'font', name: 'Fb/Font', grades: ['3', '4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C'] },
  { id: 'v', name: 'V-Skala', grades: ['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12'] },
];

export const DEFAULT_SETTINGS = {
  dayStartHour: 4,
  weightDayMode: 'mean',      // 'mean' | 'last'
  forecastWindow: 28,         // 14 | 28
  backupReminderDays: 14,
  gradeScales: DEFAULT_SCALES,
  defaultScaleId: 'font',
  hallScale: {},              // Halle → Skalen-ID (zuletzt verwendet)
  szLabel: 'Sternzeit',
  restPresets: [60, 90, 120, 180],
};

export async function getMeta(key, fallback = null) {
  const r = await get('meta', key);
  return r ? r.value : fallback;
}
export async function setMeta(key, value) {
  const db = await openDB();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  await done(tx);
}

export async function loadSettings() {
  const s = await getMeta('settings', {});
  return { ...structuredClone(DEFAULT_SETTINGS), ...s };
}
export const saveSettings = (s) => setMeta('settings', s);
