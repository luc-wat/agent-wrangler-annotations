// Core's Chat panel, wherever it is mounted. Agent Wrangler has ONE session
// panel: the board shows it in its sidebar, and api.mountSession moves the same
// nodes into an extension's element (Wrangler²'s `.job-mc-host`: a New idea's
// conversation, a step's Sessions, Phone control). So the panel is always found
// by core's own ids, and where it currently sits is read off its ancestors.
//
// Text positions are counted over the stream's text nodes in document order
// (what Range#toString concatenates), so an excerpt can be found again after the
// chat re-renders: by its exact text and which occurrence of it it was.

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

function textNodes(root) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const out = [];
  let start = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.data.length;
    if (len) out.push({ node: n, start });
    start += len;
  }
  return { nodes: out, text: out.map((x) => x.node.data).join('') };
}

export function flatText(root) {
  return textNodes(root).text;
}

// Characters of `root`'s text that come before the boundary point (node, offset).
export function offsetIn(root, node, offset) {
  const r = root.ownerDocument.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

function countBefore(text, needle, end) {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1 && i < end; i = text.indexOf(needle, i + 1)) n += 1;
  return n;
}

// The human's selection as an annotation target, or null when it is empty or
// reaches outside the chat stream (the composer, the tray, another panel).
export function selectionTarget(selection, stream) {
  if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !stream.contains(range.startContainer) || !stream.contains(range.endContainer)) return null;
  const quote = selection.toString();
  if (!quote.trim()) return null;
  const { text } = textNodes(stream);
  const start = offsetIn(stream, range.startContainer, range.startOffset);
  const end = offsetIn(stream, range.endContainer, range.endOffset);
  // Leading and trailing whitespace is never part of what is found again.
  const raw = text.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const anchor = raw.trim();
  if (!anchor) return null;
  return { quote, anchor, occurrence: countBefore(text, anchor, start + lead), range };
}

// The Range of an annotation's excerpt in the stream as it is now, or null when
// that part of the conversation is not on screen (a window of history is).
export function locate(stream, anchor, occurrence = 0) {
  if (!stream || !anchor) return null;
  const { nodes, text } = textNodes(stream);
  let at = -1;
  let first = -1;
  for (let i = text.indexOf(anchor), n = 0; i !== -1; i = text.indexOf(anchor, i + 1), n += 1) {
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
