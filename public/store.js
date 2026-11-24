// Annotations kept per session id in the browser's localStorage, so they survive
// switching pages, the panel moving between the board and a Wrangler² view, and a
// reload, until Send all clears them. Every read and write is guarded: storage
// can be missing or throw (a private window, a full quota), and then the
// annotations simply live in memory for this page.

export const KEY_PREFIX = 'aw-annotations:v1:';

const validSid = (sid) => typeof sid === 'string' && sid.length > 0 && sid.length <= 200;

function clean(a) {
  if (!a || typeof a !== 'object') return null;
  if (typeof a.id !== 'string' || typeof a.quote !== 'string' || !a.quote.trim()) return null;
  return {
    id: a.id,
    quote: a.quote,
    anchor: typeof a.anchor === 'string' ? a.anchor : a.quote,
    occurrence: Number.isInteger(a.occurrence) && a.occurrence >= 0 ? a.occurrence : 0,
    note: typeof a.note === 'string' ? a.note : '',
    createdAt: Number.isFinite(a.createdAt) ? a.createdAt : 0,
  };
}

export function createStore({ storage = globalThis.localStorage, now = () => Date.now(), newId } = {}) {
  const memory = new Map();
  const listeners = new Set();
  let seq = 0;
  const mint = newId || (() => `a${now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`);

  function read(sid) {
    if (memory.has(sid)) return memory.get(sid);
    let list = [];
    try {
      const raw = storage?.getItem(KEY_PREFIX + sid);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) list = parsed.map(clean).filter(Boolean);
    } catch { /* unreadable: start empty */ }
    memory.set(sid, list);
    return list;
  }

  function write(sid, list) {
    memory.set(sid, list);
    try {
      if (list.length) storage?.setItem(KEY_PREFIX + sid, JSON.stringify(list));
      else storage?.removeItem(KEY_PREFIX + sid);
    } catch { /* kept in memory only */ }
    for (const fn of [...listeners]) fn(sid);
  }

  return {
    list(sid) {
      return validSid(sid) ? read(sid).map((a) => ({ ...a })) : [];
    },
    add(sid, { quote, anchor, occurrence = 0, note = '' }) {
      if (!validSid(sid)) return null;
      const a = clean({ id: mint(), quote, anchor, occurrence, note, createdAt: now() });
      if (!a) return null;
      write(sid, [...read(sid), a]);
      return { ...a };
    },
    update(sid, id, note) {
      if (!validSid(sid)) return false;
      const list = read(sid);
      if (!list.some((a) => a.id === id)) return false;
      write(sid, list.map((a) => (a.id === id ? { ...a, note: String(note ?? '') } : a)));
      return true;
    },
    remove(sid, id) {
      if (!validSid(sid)) return false;
      const list = read(sid);
      const next = list.filter((a) => a.id !== id);
      if (next.length === list.length) return false;
      write(sid, next);
      return true;
    },
    clear(sid) {
      if (!validSid(sid)) return;
      write(sid, []);
    },
    // Another tab changed this session's annotations: drop the cached copy.
    forget(sid) { memory.delete(sid); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
