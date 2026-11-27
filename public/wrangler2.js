// Wrangler²'s own chats, as annotation surfaces. Wrangler² (PortSwigger/
// wrangler-squared) lends core's Chat panel for some conversations, and those are
// annotated as any Chat is. Two it draws with its own markup:
// - a step's conversation with its session, on Code review and in its History
//   (job-thread.js: section.job-thread of .job-msg.human / .agent / .system);
// - the conversations with the wrangler (job-talk.js: .job-talk-convo[data-convo],
//   what the human sent as .job-sent, the wrangler's answers as .job-talk-msg and a
//   step session's as .job-talk-session).
// Both are answered through its Add idea box (job-ask-box.js: .job-change, its
// textarea and [data-change-send]); the planner forwards the human's words to a
// step's session unchanged.
//
// That markup is another extension's private DOM, so every selector it relies on
// is here, and when it is absent or changes shape nothing is drawn and nothing
// throws. Wrangler² draws a page again on every change, so the conversations are
// found again after each redraw (a MutationObserver on <body>, once a frame) and
// each one's annotator puts its nodes back.
//
// Notes are kept per conversation under keys of their own, never a session's:
// `w2:talk:<conversation id>`, and `w2:thread:<signature>` for a step's thread,
// which carries no id in its markup (the step's title and the thread's first
// message, which never changes once sent).

import { createAnnotator } from './annotator.js';
import { OURS, setBoxText } from './panel.js';

export const SEL = {
  thread: 'section.job-thread',
  threadMsg: '.job-msg',
  threadText: '.job-msg-text',
  threadWho: '.job-msg-who',
  convo: '.job-talk-convo[data-convo]',
  folded: 'is-folded',
  convoSkip: '.job-change, .job-talk-convo-head, .job-talk-convo-foot',
  convoFoot: '.job-talk-convo-foot',
  sent: '.job-sent',
  sentText: '.job-sent-bubble > span',
  reply: '.job-talk-msg, .job-talk-session',
  replyBody: '.job-idea-body',
  root: '#job-dialog, .job-page-main',
  title: '.job-appbar h2',
  box: '.job-change',
  boxOff: '[data-idea-composer]',
  boxText: 'textarea',
  boxSend: '[data-change-send]',
};

// Wrangler²'s own limit on what one idea may say (server/job-change.js CHANGE_TEXT_MAX).
export const BOX_MAX = 8000;

export const W2_REFUSALS = {
  'no-panel': 'That conversation is no longer on screen.',
  'no-box': 'This conversation takes no reply here, so there is no Add idea box to send your notes through.',
  'too-long': `Your notes come to more than the Add idea box takes (${BOX_MAX.toLocaleString('en')} characters). Shorten or remove a note, then Send all again.`,
  'box-busy': 'Something attached in the Add idea box is still uploading or failed. Wait for it or remove it, then Send all again.',
  'not-sent': 'Wrangler² did not take the message. Your notes are kept.',
};

const squash = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

// FNV-1a, 32 bits, base 36: a short, stable name for a thread.
export function signature(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const own = (el) => !!el?.closest?.(OURS);

// The storage key for a step's thread, or null while it has no message.
export function threadKey(el) {
  const first = [...el.querySelectorAll(SEL.threadMsg)].find((m) => !own(m));
  if (!first) return null;
  const title = el.closest(SEL.root)?.querySelector(SEL.title)?.textContent || '';
  const part = (sel) => squash(first.querySelector(sel)?.textContent);
  return `w2:thread:${signature([squash(title), part(SEL.threadWho), part(SEL.threadText), part('time')].join('\n'))}`;
}

// Every Wrangler² conversation on screen that can be annotated: a thread with a
// message, and an open conversation with the wrangler.
export function findConversations(doc) {
  const out = [];
  const seen = new Set();
  const add = (key, kind, el) => { if (key && !seen.has(key)) { seen.add(key); out.push({ key, kind, el }); } };
  try {
    for (const el of doc.querySelectorAll(SEL.thread)) if (!own(el)) add(threadKey(el), 'thread', el);
    for (const el of doc.querySelectorAll(SEL.convo)) {
      const id = el.getAttribute('data-convo');
      if (id && !el.classList.contains(SEL.folded) && !own(el)) add(`w2:talk:${id}`, 'talk', el);
    }
  } catch { /* not Wrangler²'s markup: nothing to annotate */ }
  return out;
}

// The Add idea box a conversation's notes go through: an open conversation's is
// at its foot; a thread's is its step's, the one box on that page.
export function boxFor(el, kind) {
  if (kind === 'talk') {
    const id = el.getAttribute('data-convo');
    return [...el.children].find((c) => c.matches(SEL.box) && !c.matches(SEL.boxOff) && c.getAttribute('data-change-convo') === id) || null;
  }
  const root = el.closest(SEL.root) || el.ownerDocument;
  return [...root.querySelectorAll(SEL.box)].find((b) => !b.matches(SEL.boxOff)) || null;
}

// What the human sent and what was answered, in order, for replies.js.
export function threadEntries(stream) {
  return [...stream.querySelectorAll(SEL.threadMsg)].filter((m) => !own(m)).map((m) => {
    if (m.classList.contains('human')) return { kind: 'user', text: m.querySelector(SEL.threadText)?.textContent ?? '', node: m };
    if (m.classList.contains('agent')) return { kind: 'reply', node: m.querySelector(SEL.threadText) || m };
    return null;
  }).filter(Boolean);
}

export function talkEntries(stream) {
  return [...stream.querySelectorAll(`${SEL.sent}, ${SEL.reply}`)].filter((n) => !own(n) && !n.closest(SEL.box)).map((n) => {
    // Only the answer's body: its who line ends on a time that runs into its first word.
    if (!n.matches(SEL.sent)) return { kind: 'reply', node: n.querySelector(SEL.replyBody) || n };
    const spans = n.querySelectorAll(SEL.sentText);
    return { kind: 'user', text: spans.length ? spans[spans.length - 1].textContent : '', node: n };
  });
}

function surfaceOf(el, kind) {
  const box = boxFor(el, kind);
  const input = box?.querySelector(SEL.boxText) || null;
  if (kind === 'talk') {
    const before = box || [...el.children].find((c) => c.matches(SEL.convoFoot)) || null;
    return { stream: el, host: el, wrap: el, before, box, input, skip: `${OURS}, ${SEL.convoSkip}`, scrolls: false, positionHost: true };
  }
  // A thread clips what overflows it, so the floating parts go in its parent.
  return { stream: el, host: el.parentElement || el, wrap: el, before: null, box, input, skip: OURS, scrolls: false, positionHost: true };
}

// Send all: the whole message (the draft already at its foot) goes into the box
// and its own Send is pressed, exactly as the human would. Wrangler² empties the
// box when it takes the words; otherwise the draft is put back as it was.
export function sendThroughBox({ text, draft, surface }) {
  const box = surface?.box;
  const input = box?.querySelector(SEL.boxText);
  const go = box?.querySelector(SEL.boxSend);
  if (!input || !go || !box.isConnected) return { ok: false, reason: 'no-box' };
  const max = input.maxLength > 0 ? Math.min(input.maxLength, BOX_MAX) : BOX_MAX;
  if (text.length > max) return { ok: false, reason: 'too-long' };
  setBoxText(input, text);
  if (go.disabled) { setBoxText(input, draft); return { ok: false, reason: 'box-busy' }; }
  go.click();
  if (input.value.trim()) { setBoxText(input, draft); return { ok: false, reason: 'not-sent' }; }
  return { ok: true, submitted: true };
}

export function conversationAdapter(key, kind, current, batches = null) {
  return {
    batches,
    name: `wrangler2-${kind}`,
    boxName: 'Add idea box',
    sentTo: 'Wrangler',
    trayClass: `aw-annot-w2 aw-annot-w2-${kind}`,
    refusals: W2_REFUSALS,
    find() {
      const el = current();
      return el?.isConnected ? surfaceOf(el, kind) : null;
    },
    key() {
      return current()?.isConnected ? key : null;
    },
    send: sendThroughBox,
    entries: kind === 'thread' ? threadEntries : talkEntries,
  };
}

// One annotator per Wrangler² conversation on screen, kept while it is shown.
export function createWrangler2Annotations({ document: doc = globalThis.document, api = null, store, storage = globalThis.localStorage, toast = null } = {}) {
  const win = doc?.defaultView || globalThis;
  const live = new Map(); // key → { el, drawn: the element it was last refreshed on, ann }
  let frame = 0;
  let dead = false;

  // Notes sent from a step's thread are answered in that thread and, as the
  // forward's answer, in the conversation with the wrangler too: a reply is
  // matched against what any conversation on screen sent (by the sent text, so
  // one never takes another's), oldest first.
  const batches = (key) => {
    const keys = new Set([key, ...live.keys()]);
    return [...keys].flatMap((k) => store.sent(k)).sort((a, b) => a.sentAt - b.sentAt);
  };

  function scan() {
    frame = 0;
    if (dead) return;
    const found = new Map(findConversations(doc).map((c) => [c.key, c]));
    for (const [key, entry] of live) {
      if (found.has(key)) continue;
      live.delete(key);
      try { entry.ann.destroy(); } catch { /* fine */ }
    }
    for (const [key, c] of found) {
      const entry = live.get(key);
      if (!entry) {
        const e = { el: c.el, drawn: c.el, ann: null };
        live.set(key, e);
        // Drawn again since the last scan (a send redraws at once): found anew.
        const current = () => {
          if (!e.el?.isConnected) e.el = findConversations(doc).find((x) => x.key === key)?.el || e.el;
          return e.el;
        };
        try {
          e.ann = createAnnotator({ document: doc, api, store, storage, toast, adapter: conversationAdapter(key, c.kind, current, batches) });
        } catch { live.delete(key); }
      } else if (entry.drawn !== c.el) {
        entry.el = entry.drawn = c.el;
        try { entry.ann.refresh(); } catch { /* fine */ }
      }
    }
  }

  const schedule = () => {
    if (frame || dead) return;
    const raf = win.requestAnimationFrame || ((fn) => win.setTimeout(fn, 16));
    frame = raf(scan) || 1;
  };
  // Our own redraws (pins, tray, chips) never start a scan.
  const ours = (n) => !!(n?.nodeType === 1 ? n : n?.parentElement)?.closest?.(`${OURS}, .aw-annot-reply`);
  const observer = typeof win.MutationObserver === 'function'
    ? new win.MutationObserver((records) => { if (!records.every((r) => ours(r.target))) schedule(); })
    : null;
  if (doc?.body) observer?.observe(doc.body, { childList: true, subtree: true });
  scan();

  return {
    scan,
    get keys() { return [...live.keys()]; },
    annotator(key) { return live.get(key)?.ann || null; },
    destroy() {
      dead = true;
      observer?.disconnect();
      for (const { ann } of live.values()) { try { ann?.destroy(); } catch { /* fine */ } }
      live.clear();
    },
  };
}
