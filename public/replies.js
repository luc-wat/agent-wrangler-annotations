// The agent's answers to sent notes. Send all asks the agent to start each
// answer with "Re note N:" (compose.js); this finds those labels in the agent's
// messages in the Chat stream, works out which sent batch each reply answers,
// and wraps each label in a chip whose hover shows that note's excerpt and text.
// A chip is a button: chipNote() gives the note and batch it answers, and the
// annotator jumps to that note's passage when it is pressed.
//
// Which batch: a batch's own message is in the stream as a user message, so a
// reply answers the nearest batch message above it. When that message is out of
// the loaded window, a batch message BELOW the reply bounds it (the reply came
// before that batch, so it answers the one sent just before), and failing that
// the newest batch is the one.

export const LABEL = (n) => `Re note ${n}:`;

const LABEL_RE = /\bRe note (\d{1,3})\s*:/gi;

// Every label in `text`: where its "Re note N" part starts and ends (the colon
// stays outside the chip), and N.
export function findLabels(text) {
  const out = [];
  const s = String(text ?? '');
  LABEL_RE.lastIndex = 0;
  for (let m = LABEL_RE.exec(s); m; m = LABEL_RE.exec(s)) {
    const n = Number(m[1]);
    if (n < 1) continue;
    const head = m[0].replace(/\s*:$/, '');
    out.push({ start: m.index, end: m.index + head.length, n });
  }
  return out;
}

const squash = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

// Which batch (index into `batches`, oldest first) each reply answers.
// `entries` is the stream in order: { kind: 'user', text } or { kind: 'reply' }.
// Returns one index (or -1 with no batches) per reply, in order.
export function batchForReplies(entries, batches) {
  const sigs = (batches || []).map((b) => squash(b.text));
  const batchOf = (text) => {
    const t = squash(text);
    if (!t) return -1;
    for (let i = sigs.length - 1; i >= 0; i -= 1) if (sigs[i] && sigs[i] === t) return i;
    return -1;
  };
  const marks = entries.map((e) => (e.kind === 'user' ? batchOf(e.text) : -1));
  const out = [];
  let above = -1;
  entries.forEach((e, i) => {
    if (e.kind === 'user') { if (marks[i] !== -1) above = marks[i]; return; }
    if (e.kind !== 'reply') return;
    if (above !== -1) { out.push(above); return; }
    const below = marks.slice(i + 1).find((m) => m !== -1);
    if (below !== undefined) { out.push(below - 1); return; }
    out.push(sigs.length - 1);
  });
  return out;
}

// The message that sent a batch: the last user entry whose text is the batch's
// that comes before `upTo` (a node in the stream), or the last one at all.
export function sentMessage(entries, text, upTo = null) {
  const sig = squash(text);
  if (!sig) return null;
  const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
  const sent = entries.filter((e) => e.kind === 'user' && e.node && squash(e.text) === sig);
  const above = upTo ? sent.filter((e) => e.node.compareDocumentPosition(upTo) & FOLLOWING) : sent;
  return (above.length ? above : sent).at(-1)?.node || null;
}

const CHIP = 'aw-annot-reply';
const chipNotes = new WeakMap(); // chip → { item, batch }

// The sent note a chip answers and the batch it was in, or null.
export function chipNote(chip) {
  return chipNotes.get(chip) || null;
}

function textNodesOf(root) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  let start = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n, start });
    start += n.data.length;
  }
  return { nodes, text: nodes.map((x) => x.node.data).join('') };
}

// Core Chat's user messages and agent replies, in order. Another chat
// (wrangler2.js) passes its own `entries`: { kind: 'user', text } for what the
// human sent, { kind: 'reply', node } for each answer, the node holding its text.
export function chatEntries(stream) {
  const out = [];
  for (const node of stream.children) {
    if (node.classList.contains('chat-user')) out.push({ kind: 'user', text: node.querySelector('.chat-user-text')?.textContent ?? node.textContent, node });
    else if (node.classList.contains('chat-assistant')) out.push({ kind: 'reply', node });
  }
  return out;
}

// Wrap every label in the agent's replies in a chip carrying its note, and
// refresh chips already drawn. Idempotent: our own changes leave nothing new
// to do, so the stream's MutationObserver settles. Returns the chips.
export function labelReplies(stream, batches, { entries: entriesOf = chatEntries } = {}) {
  if (!stream) return [];
  const doc = stream.ownerDocument;
  const entries = entriesOf(stream);
  const replies = entries.filter((e) => e.kind === 'reply');
  const which = batchForReplies(entries, batches);
  const chips = [];
  replies.forEach((r, i) => {
    const batch = batches?.[which[i]] || null;
    const noteOf = (n) => batch?.items?.find((x) => x.n === n) || null;
    // Chips from an earlier pass: keep them if their note still exists.
    for (const chip of r.node.querySelectorAll(`.${CHIP}`)) {
      const item = noteOf(Number(chip.dataset.n));
      if (item) { dress(chip, item, batch); chips.push(chip); } else { chipNotes.delete(chip); chip.replaceWith(...chip.childNodes); }
    }
    if (!batch) return;
    const { nodes, text } = textNodesOf(r.node);
    const found = findLabels(text).filter((l) => noteOf(l.n));
    // Right to left, so splitting a node never moves a label still to come.
    for (const l of found.reverse()) {
      const hit = nodes.find((x) => x.start <= l.start && l.end <= x.start + x.node.data.length);
      if (!hit || hit.node.parentElement?.closest(`.${CHIP}, a, button, code, pre`)) continue;
      const from = l.start - hit.start;
      const label = hit.node.splitText(from);
      label.splitText(l.end - l.start);
      const chip = doc.createElement('span');
      chip.className = CHIP;
      chip.dataset.n = String(l.n);
      chip.tabIndex = 0;
      chip.setAttribute('role', 'button');
      label.replaceWith(chip);
      chip.append(label);
      dress(chip, noteOf(l.n), batch);
      chips.push(chip);
    }
  });
  return chips;
}

function dress(chip, item, batch) {
  chipNotes.set(chip, { item, batch });
  if (chip.dataset.quote !== item.quote) chip.dataset.quote = item.quote;
  if (chip.dataset.note !== item.note) chip.dataset.note = item.note;
  const aria = `Answers note ${item.n}: ${item.note || item.quote}`;
  if (chip.getAttribute('aria-label') !== aria) chip.setAttribute('aria-label', aria);
}
