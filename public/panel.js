// Core's Chat panel, wherever it is mounted. Agent Wrangler has ONE session
// panel: the board shows it in its sidebar, and api.mountSession moves the same
// nodes into an extension's element (Wrangler²'s `.job-mc-host`: a New idea's
// conversation, a step's Sessions, Phone control). So the panel is always found
// by core's own ids, and where it currently sits is read off its ancestors.
//
// Text positions are counted over the stream's text nodes in document order
// (what Range#toString concatenates, less any skipped part: our own nodes, and
// whatever an adapter says is not the conversation), so an excerpt can be found
// again after the chat re-renders: by its exact text and which occurrence of it
// it was.

export function findChatPanel(doc = globalThis.document) {
  const wrap = doc?.getElementById?.('chat-wrap');
  const stream = doc?.getElementById?.('chat-stream');
  const streamWrap = doc?.getElementById?.('chat-stream-wrap') || stream?.parentElement || null;
  const composer = doc?.getElementById?.('chat-composer');
  if (!wrap || !stream || !streamWrap || !wrap.contains(stream)) return null;
  return { wrap, stream, streamWrap, composer: composer && wrap.contains(composer) ? composer : null, input: doc.getElementById('chat-input') };
}

// Where the panel is: lent to Wrangler² (or any extension view), or home on the board.
export function panelHome(panel) {
  if (!panel?.wrap) return null;
  if (panel.wrap.closest('.job-mc-host')) return 'wrangler';
  if (panel.wrap.closest('.session-embed')) return 'embedded';
  return 'board';
}

// Shown means Chat is the open view and nothing hides it.
export function chatShown(panel) {
  if (!panel?.wrap || panel.wrap.hidden) return false;
  if (panel.wrap.closest('[hidden], .collapsed, [inert]')) return false;
  return panel.wrap.isConnected !== false;
}

// Our own nodes (layer, tray, editor, hover card) carry UI_CLASS. Where they sit
// inside a conversation (Wrangler²'s chats), their text is never counted as part of
// it; an adapter may skip more (a message box, a header) with its own selector.
export const UI_CLASS = 'aw-annot-ui';
export const OURS = `.${UI_CLASS}`;

const skipped = (root, node, skip) => {
  if (!skip) return false;
  const el = node.nodeType === 1 ? node : node.parentElement;
  const hit = el?.closest?.(skip);
  return !!hit && hit !== root && root.contains(hit);
};

function textNodes(root, skip = OURS) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const out = [];
  let start = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.data.length;
    if (!len || skipped(root, n, skip)) continue;
    out.push({ node: n, start });
    start += len;
  }
  return { nodes: out, text: out.map((x) => x.node.data).join('') };
}

export function flatText(root, skip = OURS) {
  return textNodes(root, skip).text;
}

const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
// The first counted character at or after `ref` (itself, inside it, or after it),
// or after the whole of `ref` when `past`.
function startFrom(nodes, total, ref, past) {
  const hit = nodes.find(({ node }) => (past
    ? node !== ref && !ref.contains(node) && (ref.compareDocumentPosition(node) & FOLLOWING)
    : node === ref || ref.contains(node) || (ref.compareDocumentPosition(node) & FOLLOWING)));
  return hit ? hit.start : total;
}

function pointIn({ nodes, text }, node, offset) {
  if (node.nodeType === 3) {
    const hit = nodes.find((x) => x.node === node);
    return hit ? hit.start + Math.min(offset, node.data.length) : startFrom(nodes, text.length, node, true);
  }
  const child = node.childNodes[offset];
  return child ? startFrom(nodes, text.length, child, false) : startFrom(nodes, text.length, node, true);
}

// Characters of `root`'s counted text that come before the boundary point (node, offset).
export function offsetIn(root, node, offset, skip = OURS) {
  return pointIn(textNodes(root, skip), node, offset);
}

function countBefore(text, needle, end) {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1 && i < end; i = text.indexOf(needle, i + 1)) n += 1;
  return n;
}

// The human's selection as an annotation target, or null when it is empty or
// reaches outside the chat stream (the composer, the tray, another panel) or into
// a part of it that is skipped.
export function selectionTarget(selection, stream, skip = OURS) {
  if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !stream.contains(range.startContainer) || !stream.contains(range.endContainer)) return null;
  if (skipped(stream, range.startContainer, skip) || skipped(stream, range.endContainer, skip)) return null;
  const quote = selection.toString();
  if (!quote.trim()) return null;
  const flat = textNodes(stream, skip);
  const { text } = flat;
  const start = pointIn(flat, range.startContainer, range.startOffset);
  const end = pointIn(flat, range.endContainer, range.endOffset);
  // Leading and trailing whitespace is never part of what is found again.
  const raw = text.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const anchor = raw.trim();
  if (!anchor) return null;
  return { quote, anchor, occurrence: countBefore(text, anchor, start + lead), range };
}

// The Range of an annotation's excerpt in the stream as it is now, or null when
// that part of the conversation is not on screen (a window of history is).
// Occurrences are counted over the whole stream, but one is only taken when it
// ends before `before` (an element: a passage noted before a message was sent is
// above that message) and lies in none of `avoid` (elements quoting it since).
export function locate(stream, anchor, occurrence = 0, skip = OURS, { before = null, avoid = [] } = {}) {
  if (!stream || !anchor) return null;
  const { nodes, text } = textNodes(stream, skip);
  const inside = (el) => el && el !== stream && stream.contains(el);
  const limit = inside(before) ? startFrom(nodes, text.length, before, false) : text.length;
  const spans = (avoid || []).filter(inside).map((el) => [startFrom(nodes, text.length, el, false), startFrom(nodes, text.length, el, true)]);
  const ok = (i) => i + anchor.length <= limit && !spans.some(([a, b]) => i < b && i + anchor.length > a);
  let at = -1;
  let first = -1;
  for (let i = text.indexOf(anchor), n = 0; i !== -1; i = text.indexOf(anchor, i + 1), n += 1) {
    if (!ok(i)) continue;
    if (first === -1) first = i;
    if (n === occurrence) { at = i; break; }
  }
  if (at === -1) at = first;
  if (at === -1) return null;
  const point = (pos, isEnd) => {
    for (let k = nodes.length - 1; k >= 0; k -= 1) {
      const { node, start } = nodes[k];
      if (isEnd ? start < pos : start <= pos) return [node, Math.min(pos - start, node.data.length)];
    }
    return null;
  };
  const s = point(at, false);
  const e = point(at + anchor.length, true);
  if (!s || !e) return null;
  const r = stream.ownerDocument.createRange();
  r.setStart(s[0], s[1]);
  r.setEnd(e[0], e[1]);
  return r;
}

// Set a message box's text as typing would, so its owner redraws (height, the
// Send button) and keeps its draft.
export function setBoxText(input, value) {
  if (!input) return;
  input.value = value;
  const win = input.ownerDocument?.defaultView || globalThis;
  try { input.dispatchEvent(new win.Event('input', { bubbles: true })); } catch { /* fine */ }
}

// Core's Chat panel as an annotation surface (annotator.js): the session is the
// one the panel shows, and Send all types through api.sessionPanel.type, which
// writes into that panel's composer and sends it.
export const CORE_REFUSALS = {
  'no-panel': 'Open the session’s Chat to send your notes.',
  gated: 'This session is locked, so nothing can be typed into it.',
  blocked: 'The session is waiting on a prompt in its Terminal; answer it first.',
  'not-sent': 'The message is in the box but did not send (no connection?). Press Send, then Clear the notes.',
  capability: 'Agent Wrangler refused typing into the session (session:type).',
  unsupported: 'This Agent Wrangler cannot type into a session (host API 1.68 or later is needed).',
};

export function coreChatAdapter(doc, api) {
  return {
    name: 'chat',
    boxName: 'message box',
    sentTo: 'the session',
    refusals: CORE_REFUSALS,
    find() {
      const p = findChatPanel(doc);
      return p && { stream: p.stream, host: p.streamWrap, wrap: p.wrap, before: p.composer, input: p.input, scrolls: true };
    },
    key() {
      try { return api?.front?.()?.session || null; } catch { return null; }
    },
    watch(fn) {
      return typeof api?.front?.onChange === 'function' ? api.front.onChange(fn) : null;
    },
    // type() appends to the box, so the draft (already in the message) is taken
    // out first, or it would be sent twice, and put back if the send fails.
    send({ text, draft, surface }) {
      if (typeof api?.sessionPanel?.type !== 'function') return { ok: false, reason: 'unsupported' };
      const input = surface?.input || null;
      if (draft && input) setBoxText(input, '');
      const r = api.sessionPanel.type(text, { submit: true }) || { ok: false, reason: 'no-panel' };
      if (!(r.ok && r.submitted) && draft && input) setBoxText(input, draft);
      return r;
    },
  };
}
