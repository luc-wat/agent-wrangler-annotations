// Annotations kept per session id in the browser's localStorage, so they survive
// switching pages, the panel moving between the board and a Wrangler² view, and a
// reload, until Send all clears them. Every read and write is guarded: storage
// can be missing or throw (a private window, a full quota), and then the
// annotations simply live in memory for this page.

export const KEY_PREFIX = 'aw-annotations:v1:';
// What Send all sent, kept so the agent's "Re note N:" labels can show the note
// they answer and jump back to its passage. Oldest first, the last MAX_SENT
// batches per session.
export const SENT_PREFIX = 'aw-annotations:sent:v1:';
export const MAX_SENT = 20;

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

function cleanBatch(b) {
  if (!b || typeof b !== 'object' || typeof b.text !== 'string' || !Array.isArray(b.items)) return null;
  const items = b.items
    .filter((x) => x && Number.isInteger(x.n) && x.n > 0 && typeof x.quote === 'string')
    .map((x) => {
      const item = { n: x.n, quote: x.quote, note: typeof x.note === 'string' ? x.note : '' };
      // Where the passage is; a batch saved before these were kept has neither,
      // and its chips look for the excerpt instead.
      if (typeof x.anchor === 'string' && x.anchor) {
        item.anchor = x.anchor;
        if (Number.isInteger(x.occurrence) && x.occurrence >= 0) item.occurrence = x.occurrence;
      }
      return item;
    });
  if (!items.length) return null;
  return { text: b.text, sentAt: Number.isFinite(b.sentAt) ? b.sentAt : 0, items };
}

export function createStore({ storage = globalThis.localStorage, now = () => Date.now(), newId } = {}) {
  const memory = new Map();
  const sentMemory = new Map();
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

  function readSent(sid) {
    if (sentMemory.has(sid)) return sentMemory.get(sid);
    let list = [];
    try {
      const raw = storage?.getItem(SENT_PREFIX + sid);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) list = parsed.map(cleanBatch).filter(Boolean);
    } catch { /* unreadable: start empty */ }
    sentMemory.set(sid, list);
    return list;
  }

  return {
    // Record one sent batch: the message text and each note as it numbered them.
    recordSent(sid, { text, items }) {
      if (!validSid(sid)) return null;
      const b = cleanBatch({ text, items, sentAt: now() });
      if (!b) return null;
      const list = [...readSent(sid), b].slice(-MAX_SENT);
      sentMemory.set(sid, list);
      try { storage?.setItem(SENT_PREFIX + sid, JSON.stringify(list)); } catch { /* kept in memory only */ }
      for (const fn of [...listeners]) fn(sid);
      return structuredClone(b);
    },
    sent(sid) {
      return validSid(sid) ? structuredClone(readSent(sid)) : [];
    },
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
    forgetSent(sid) { sentMemory.delete(sid); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
