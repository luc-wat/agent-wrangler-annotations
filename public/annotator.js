// The annotation UI on one conversation: an "Annotate" button over a fresh
// selection, a note editor, the marks (CSS highlights plus numbered pins) and
// the tray listing every note with Edit and Remove, and Send all.
//
// Which conversation, and how its notes are sent, is the adapter's:
// - core's Chat panel (panel.js coreChatAdapter, the default): the session the
//   panel shows, sent through api.sessionPanel.type;
// - one of Wrangler²'s own chats (wrangler2.js): a step's conversation with its
//   session or a conversation with the wrangler, sent through its Add idea box.
//
// An adapter's find() returns the surface as it is now: `stream` (the text that
// is annotated), `host` (a positioned element the floating UI goes in), `wrap`
// and `before` (where the tray goes), `input` (the box whose draft is appended),
// `skip` (parts of the stream that are not the conversation) and `scrolls`
// (whether the stream scrolls itself). Everything is drawn INSIDE those nodes,
// never on <body>: the panel or the chat may sit in a modal <dialog>, and
// anything outside it would be inert there. When they move or are drawn again,
// ensure() puts the same nodes back, so what is typed in them survives.
//
// What was sent is kept (store.recordSent), and the agent's "Re note N:" labels
// in its replies become chips whose hover card shows that note (replies.js). An
// adapter's batches(key) may widen which sent batches a reply is matched against.

import { composeMessage, sentItems, tidyQuote } from './compose.js';
import { coreChatAdapter, selectionTarget, locate, UI_CLASS, OURS } from './panel.js';
import { labelReplies } from './replies.js';
import { KEY_PREFIX, SENT_PREFIX } from './store.js';

const HL = 'aw-annotation';
const HL_FOCUS = 'aw-annotation-focus';
const COLLAPSED_KEY = 'aw-annotations:tray-collapsed';

const PEN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function button(doc, cls, label, onClick) {
  const b = el(doc, 'button', cls, label);
  b.type = 'button';
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(e); });
  return b;
}

const excerpt = (text, max = 220) => {
  const t = tidyQuote(text).replace(/\n/g, ' ');
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
};

// Several conversations can be on screen at once (the board's Chat beside a
// Wrangler² page, a step's session thread beside its wrangler conversation), but
// a highlight name is the page's: each annotator lends its ranges to one set.
const highlightOwners = new WeakMap(); // window → Map(owner → { all, focus })
function lendHighlights(win, owner, all, focus) {
  const highlights = win.CSS?.highlights;
  const Highlight = win.Highlight;
  if (!highlights || typeof Highlight !== 'function') return;
  let owners = highlightOwners.get(win);
  if (!owners) highlightOwners.set(win, (owners = new Map()));
  if (all || focus) owners.set(owner, { all: all || [], focus: focus || [] });
  else owners.delete(owner);
  if (!owners.size) { highlights.delete(HL); highlights.delete(HL_FOCUS); return; }
  const lent = [...owners.values()];
  highlights.set(HL, new Highlight(...lent.flatMap((x) => x.all)));
  highlights.set(HL_FOCUS, new Highlight(...lent.flatMap((x) => x.focus)));
}

let instances = 0;

export function createAnnotator({ document: doc = globalThis.document, api = null, store, storage = globalThis.localStorage, toast = null, adapter = null } = {}) {
  const win = doc.defaultView || globalThis;
  const source = adapter || coreChatAdapter(doc, api);
  const owner = {};
  let panel = null;
  let sid = null;
  let drawnFor = undefined; // the key the tray was last drawn for, on a surface
  let editing = null; // { sid, target } while the new-note editor is open
  let editingItem = null; // the tray item whose note is being edited
  let selTarget = null;
  let flashId = null; // a passage just revealed from the tray, drawn in the focus colour briefly
  let flashTimer = 0;
  let frame = 0;
  let labelsDirty = true;
  let popChip = null;
  let uiFocus = null; // our field that had focus, given it back when our nodes move
  let collapsed = false;
  try { collapsed = storage?.getItem(COLLAPSED_KEY) === '1'; } catch { /* default open */ }
  const offs = [];

  const ui = {
    layer: el(doc, 'div', `aw-annot-layer ${UI_CLASS}`),
    annotate: el(doc, 'button', `aw-annot-add ${UI_CLASS}`),
    editor: el(doc, 'form', `aw-annot-editor ${UI_CLASS}`),
    tray: el(doc, 'section', `aw-annot-tray ${UI_CLASS}`),
    pop: el(doc, 'div', `aw-annot-reply-pop ${UI_CLASS}`),
  };
  ui.pop.hidden = true;
  ui.pop.id = `aw-annot-reply-pop${instances ? `-${instances}` : ''}`;
  instances += 1;
  ui.pop.setAttribute('role', 'tooltip');
  ui.layer.setAttribute('aria-hidden', 'true');
  ui.annotate.type = 'button';
  ui.annotate.innerHTML = `${PEN}<span>Annotate</span>`;
  ui.annotate.title = 'Add a note on this passage';
  ui.annotate.hidden = true;
  ui.editor.hidden = true;
  ui.tray.hidden = true;
  ui.tray.setAttribute('aria-label', 'Annotations');
  ui.tray.classList.add(...String(source.trayClass || '').split(/\s+/).filter(Boolean));

  // The selection is kept while the button is pressed.
  ui.annotate.addEventListener('mousedown', (e) => e.preventDefault());
  ui.annotate.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selTarget) openEditor(selTarget);
  });
  for (const n of [ui.editor, ui.tray]) {
    n.addEventListener('focusin', (e) => { if (e.target?.matches?.('textarea')) uiFocus = e.target; });
    n.addEventListener('focusout', (e) => { if (e.target === uiFocus && e.target.isConnected && e.relatedTarget) uiFocus = null; });
  }

  const keyNow = () => {
    try { return source.key() || null; } catch { return null; }
  };
  const skipOf = (p) => p?.skip || OURS;

  // Attach our nodes to the surface, again whenever it was drawn anew or moved
  // (core's panel nodes are only ever moved; Wrangler² draws its chats again on
  // every change). Returns the surface or null.
  function ensure() {
    let p = null;
    try { p = source.find(); } catch { p = null; }
    if (!p) return null;
    if (panel?.stream !== p.stream) {
      if (panel) {
        panel.stream.removeEventListener('scroll', schedulePaint);
        for (const [type, fn] of popEvents) panel.stream.removeEventListener(type, fn);
      }
      p.stream.addEventListener('scroll', schedulePaint, { passive: true });
      for (const [type, fn] of popEvents) p.stream.addEventListener(type, fn);
      if (streamObserver) { streamObserver.disconnect(); streamObserver.observe(p.stream, { childList: true, subtree: true, characterData: true }); }
      labelsDirty = true;
    }
    panel = p;
    if (p.positionHost && !p.host.classList.contains('aw-annot-host')) p.host.classList.add('aw-annot-host');
    const lost = uiFocus && !uiFocus.isConnected ? uiFocus : null;
    for (const n of [ui.layer, ui.annotate, ui.editor, ui.pop]) if (n.parentNode !== p.host) p.host.append(n);
    if (ui.tray.parentNode !== p.wrap || (p.before && ui.tray.nextSibling !== p.before)) p.wrap.insertBefore(ui.tray, p.before || null);
    if (lost?.isConnected && (!doc.activeElement || doc.activeElement === doc.body)) {
      try { lost.focus({ preventScroll: true }); } catch { /* fine */ }
    }
    return p;
  }

  // Our own redraws (pins, the tray) are inside the stream on some surfaces: only
  // a change to the conversation itself relabels it.
  const ours = (n) => !!(n?.nodeType === 1 ? n : n?.parentElement)?.closest?.(OURS);
  const onStreamChange = (records) => {
    if (Array.isArray(records) && records.length && records.every((r) => ours(r.target))) return;
    labelsDirty = true;
    schedulePaint();
  };
  const streamObserver = typeof win.MutationObserver === 'function' ? new win.MutationObserver(onStreamChange) : null;

  // ── reply labels: the hover card ────────────────────────────────────────
  const chipOf = (e) => e?.target?.closest?.('.aw-annot-reply') || null;
  function showPop(chip) {
    const p = panel;
    if (!p || !chip?.isConnected) return;
    popChip = chip;
    ui.pop.replaceChildren(
      el(doc, 'div', 'aw-annot-reply-pop-head', `Your note ${chip.dataset.n}`),
      el(doc, 'blockquote', 'aw-annot-reply-pop-quote', excerpt(chip.dataset.quote || '', 300)),
      el(doc, 'p', `aw-annot-reply-pop-note${chip.dataset.note ? '' : ' empty'}`, chip.dataset.note || 'No note: the passage alone was sent.'),
    );
    chip.setAttribute('aria-describedby', ui.pop.id);
    ui.pop.hidden = false;
    const box = p.host.getBoundingClientRect();
    const r = chip.getBoundingClientRect();
    const width = Math.min(360, Math.max(220, box.width - 24));
    ui.pop.style.width = `${width}px`;
    const height = ui.pop.offsetHeight || 120;
    const below = r.bottom - box.top + 6;
    const top = below + height <= box.height - 8 ? below : r.top - box.top - height - 6;
    ui.pop.style.top = `${Math.max(8, top)}px`;
    ui.pop.style.left = `${Math.max(8, Math.min(r.left - box.left, box.width - width - 8))}px`;
  }
  function hidePop() {
    popChip?.removeAttribute('aria-describedby');
    popChip = null;
    ui.pop.hidden = true;
  }
  const popEvents = [
    ['mouseover', (e) => { const c = chipOf(e); if (c && c !== popChip) showPop(c); }],
    ['mouseout', (e) => { if (chipOf(e) && !chipOf({ target: e.relatedTarget })) hidePop(); }],
    ['focusin', (e) => { const c = chipOf(e); if (c) showPop(c); }],
    ['focusout', (e) => { if (chipOf(e)) hidePop(); }],
  ];

  // ── selection → Annotate button ─────────────────────────────────────────
  function onSelectionEnd() {
    const p = ensure();
    if (!p || editing) return;
    const sel = win.getSelection?.();
    const target = keyNow() ? selectionTarget(sel, p.stream, skipOf(p)) : null;
    selTarget = target;
    if (!target) { ui.annotate.hidden = true; return; }
    const rects = target.range.getClientRects?.() || [];
    const last = rects.length ? rects[rects.length - 1] : target.range.getBoundingClientRect?.();
    const box = p.host.getBoundingClientRect();
    if (!last) { ui.annotate.hidden = true; return; }
    const top = Math.max(4, Math.min(last.bottom - box.top + 6, box.height - 36));
    const left = Math.max(4, Math.min(last.right - box.left - 40, box.width - 120));
    ui.annotate.style.top = `${top}px`;
    ui.annotate.style.left = `${left}px`;
    ui.annotate.hidden = false;
  }
  const deferSelection = () => win.setTimeout(onSelectionEnd, 0);
  const onSelectionChange = () => {
    const sel = win.getSelection?.();
    if (!ui.annotate.hidden && (!sel || sel.isCollapsed)) ui.annotate.hidden = true;
  };

  // ── the new-note editor ─────────────────────────────────────────────────
  function openEditor(target) {
    const p = ensure();
    const at = keyNow();
    if (!p || !at) return;
    editing = { sid: at, target };
    ui.annotate.hidden = true;
    ui.editor.replaceChildren();
    const quote = el(doc, 'blockquote', 'aw-annot-editor-quote', excerpt(target.quote, 300));
    const box = el(doc, 'textarea', 'aw-annot-editor-text');
    box.rows = 3;
    box.placeholder = 'Your note on this passage…';
    box.setAttribute('aria-label', 'Note');
    const save = el(doc, 'button', 'aw-annot-primary', 'Add note');
    save.type = 'submit';
    const cancel = button(doc, 'aw-annot-quiet', 'Cancel', closeEditor);
    const row = el(doc, 'div', 'aw-annot-editor-row');
    row.append(el(doc, 'span', 'aw-annot-hint', '⌘/Ctrl+Enter to add · Esc to cancel'), cancel, save);
    ui.editor.append(quote, box, row);
    ui.editor.onsubmit = (e) => { e.preventDefault(); saveNew(box.value); };
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEditor(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); saveNew(box.value); }
    });
    ui.editor.hidden = false;
    placeEditor(p, target.range);
    box.focus();
    paint();
  }

  // Below the passage when there is room, above it otherwise, never off the pane.
  function placeEditor(p, range) {
    const wrapBox = p.host.getBoundingClientRect();
    const rects = range.getClientRects?.() || [];
    const first = rects[0] || range.getBoundingClientRect?.();
    const last = rects[rects.length - 1] || first;
    const width = Math.min(420, Math.max(240, wrapBox.width - 24));
    ui.editor.style.width = `${width}px`;
    const height = ui.editor.offsetHeight || 170;
    const below = last ? last.bottom - wrapBox.top + 8 : 12;
    const above = first ? first.top - wrapBox.top - height - 8 : 12;
    const top = below + height <= wrapBox.height - 8 || above < 8 ? below : above;
    const left = first ? first.left - wrapBox.left : 12;
    ui.editor.style.left = `${Math.max(8, Math.min(left, wrapBox.width - width - 8))}px`;
    ui.editor.style.top = `${Math.max(8, Math.min(top, wrapBox.height - height - 8))}px`;
  }

  function closeEditor() {
    editing = null;
    ui.editor.hidden = true;
    ui.editor.replaceChildren();
    paint();
  }

  function saveNew(note) {
    if (!editing) return;
    const { sid: at, target } = editing;
    store.add(at, { quote: target.quote, anchor: target.anchor, occurrence: target.occurrence, note: note.trim() });
    try { win.getSelection?.()?.removeAllRanges(); } catch { /* fine */ }
    selTarget = null;
    closeEditor();
    if (collapsed) setCollapsed(false);
  }

  // ── marks: highlights and numbered pins ────────────────────────────────
  function schedulePaint() {
    if (frame) return;
    const raf = win.requestAnimationFrame || ((fn) => win.setTimeout(fn, 16));
    frame = raf(() => { frame = 0; paint(); });
  }

  function rangesNow() {
    if (!panel || !sid) return [];
    return store.list(sid).map((a, i) => ({ a, n: i + 1, range: locate(panel.stream, a.anchor, a.occurrence, skipOf(panel)) }));
  }

  function paint() {
    const located = rangesNow();
    const focusId = editingItem || flashId;
    const all = located.filter((x) => x.range && x.a.id !== focusId).map((x) => x.range);
    if (editing?.target?.range) all.push(editing.target.range);
    const focus = located.filter((x) => x.range && x.a.id === focusId).map((x) => x.range);
    lendHighlights(win, owner, all, focus);
    ui.layer.replaceChildren();
    if (!panel) return;
    if (labelsDirty) {
      labelsDirty = false;
      labelReplies(panel.stream, sid ? (source.batches ? source.batches(sid) : store.sent(sid)) : [], source.entries ? { entries: source.entries } : undefined);
      if (popChip && !popChip.isConnected) hidePop();
      streamObserver?.takeRecords?.();
    }
    const box = panel.host.getBoundingClientRect();
    const view = panel.stream.getBoundingClientRect();
    for (const { a, n, range } of located) {
      if (!range) continue;
      const first = range.getClientRects?.()[0];
      if (!first || (!first.width && !first.height)) continue;
      if (first.bottom < view.top || first.top > view.bottom) continue;
      const pin = el(doc, 'span', `aw-annot-pin${a.id === focusId ? ' focus' : ''}`, String(n));
      pin.style.top = `${first.top - box.top - 12}px`;
      pin.style.left = `${Math.max(2, first.left - box.left - 14)}px`;
      ui.layer.append(pin);
    }
    for (const li of ui.tray.querySelectorAll('.aw-annot-item')) {
      const hit = located.find((x) => x.a.id === li.dataset.id);
      li.classList.toggle('offscreen', !hit?.range);
    }
  }

  function reveal(id) {
    const hit = rangesNow().find((x) => x.a.id === id);
    if (!hit?.range || !panel) { toastOf('That passage is not in the loaded part of the conversation.', 'info'); return; }
    if (panel.scrolls) {
      const r = hit.range.getBoundingClientRect();
      const v = panel.stream.getBoundingClientRect();
      panel.stream.scrollTop += r.top - v.top - v.height / 3;
    } else {
      const at = hit.range.startContainer;
      (at.nodeType === 1 ? at : at.parentElement)?.scrollIntoView?.({ block: 'center' });
    }
    flashId = id;
    win.clearTimeout(flashTimer);
    flashTimer = win.setTimeout(() => { flashId = null; paint(); }, 1600);
    paint();
  }

  // ── the tray ────────────────────────────────────────────────────────────
  function setCollapsed(on) {
    collapsed = on;
    try { storage?.setItem(COLLAPSED_KEY, on ? '1' : '0'); } catch { /* fine */ }
    render();
  }

  let clearArmed = null;
  // The tray is drawn even while the surface is away (mid-redraw), so it is
  // right when it is put back.
  function render() {
    const p = ensure();
    if (p) drawnFor = sid;
    const list = sid ? store.list(sid) : [];
    ui.tray.hidden = list.length === 0;
    ui.tray.classList.toggle('collapsed', collapsed);
    ui.tray.replaceChildren();
    labelsDirty = true;
    if (!list.length) { editingItem = null; paint(); return; }

    const head = el(doc, 'div', 'aw-annot-head');
    const toggle = button(doc, 'aw-annot-toggle', '', () => setCollapsed(!collapsed));
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.append(el(doc, 'span', 'aw-annot-caret', collapsed ? '▸' : '▾'), el(doc, 'span', 'aw-annot-title', `${list.length} ${list.length === 1 ? 'note' : 'notes'}`));
    const clear = button(doc, 'aw-annot-quiet', clearArmed ? 'Confirm clear' : 'Clear', () => {
      if (!clearArmed) { clearArmed = win.setTimeout(() => { clearArmed = null; render(); }, 3000); render(); return; }
      win.clearTimeout(clearArmed); clearArmed = null; store.clear(sid);
    });
    if (clearArmed) clear.classList.add('armed');
    const send = button(doc, 'aw-annot-primary aw-annot-send', 'Send all', sendAll);
    send.title = `Send every note to ${source.sentTo || 'the session'} as one message, with anything typed in the ${source.boxName || 'message box'} at the end`;
    head.append(toggle, el(doc, 'span', 'aw-annot-spacer'), clear, send);
    ui.tray.append(head);
    if (collapsed) { paint(); return; }

    const ol = el(doc, 'ol', 'aw-annot-list');
    list.forEach((a, i) => ol.append(itemNode(a, i + 1)));
    ui.tray.append(ol, el(doc, 'p', 'aw-annot-foot', `Anything typed in the ${source.boxName || 'message box'} is sent after your notes, in the same message.`));
    paint();
  }

  function itemNode(a, n) {
    const li = el(doc, 'li', 'aw-annot-item');
    li.dataset.id = a.id;
    const num = el(doc, 'span', 'aw-annot-num', String(n));
    const body = el(doc, 'div', 'aw-annot-body');
    const quote = el(doc, 'button', 'aw-annot-quote', excerpt(a.quote));
    quote.type = 'button';
    quote.title = 'Show this passage';
    quote.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); reveal(a.id); });
    body.append(quote);
    if (editingItem === a.id) {
      li.classList.add('editing');
      const box = el(doc, 'textarea', 'aw-annot-edit-text');
      box.value = a.note;
      box.rows = 3;
      box.setAttribute('aria-label', `Note ${n}`);
      const done = () => { store.update(sid, a.id, box.value.trim()); editingItem = null; render(); };
      const cancel = () => { editingItem = null; render(); };
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); done(); }
      });
      const row = el(doc, 'div', 'aw-annot-actions');
      row.append(button(doc, 'aw-annot-quiet', 'Cancel', cancel), button(doc, 'aw-annot-primary', 'Save', done));
      body.append(box, row);
      win.setTimeout(() => { if (box.isConnected) { box.focus(); box.setSelectionRange?.(box.value.length, box.value.length); } }, 0);
    } else {
      body.append(el(doc, 'p', `aw-annot-note${a.note ? '' : ' empty'}`, a.note || 'No note: the passage alone is sent.'));
      const row = el(doc, 'div', 'aw-annot-actions');
      row.append(
        button(doc, 'aw-annot-quiet', 'Edit', () => { editingItem = a.id; render(); }),
        button(doc, 'aw-annot-quiet aw-annot-remove', 'Remove', () => { if (editingItem === a.id) editingItem = null; store.remove(sid, a.id); }),
      );
      li.append(num, body, row);
      return li;
    }
    li.append(num, body);
    return li;
  }

  // ── Send all ────────────────────────────────────────────────────────────
  function toastOf(text, severity) {
    if (toast) return toast(text, severity);
    try { if (api?.ui?.toast?.({ text, severity }) === true) return; } catch { /* fall through */ }
    win.console?.info?.(`[annotations] ${text}`);
  }

  // Whatever is typed in the surface's box goes at the bottom of the notes, in
  // the same message; the adapter sends it and leaves the draft as it was when
  // the message does not go.
  function sendAll() {
    const at = keyNow();
    const list = at ? store.list(at) : [];
    if (!at || at !== sid || !list.length) return { ok: false, reason: 'no-session' };
    if (editingItem) { toastOf('Save or cancel the note you are editing first.', 'warning'); return { ok: false, reason: 'editing' }; }
    const p = ensure();
    const draft = p?.input ? p.input.value : '';
    const text = composeMessage(list, { draft });
    let r;
    try { r = source.send({ text, draft, surface: p }); } catch { r = null; }
    r ||= { ok: false, reason: 'no-panel' };
    if (r.ok && r.submitted) {
      store.recordSent(at, { text, items: sentItems(list) });
      store.clear(at);
      toastOf(`Sent ${list.length} ${list.length === 1 ? 'note' : 'notes'} to ${source.sentTo || 'the session'}.`, 'success');
    } else {
      toastOf(source.refusals?.[r.reason] || `Not sent (${r.reason || 'unknown'}).`, 'error');
    }
    return r;
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  // The tray is drawn again when the conversation changes or was never drawn on a
  // surface; otherwise our nodes are only put back, keeping a note being edited.
  function refresh() {
    const next = keyNow();
    if (next !== sid) {
      sid = next;
      editingItem = null;
      if (editing && editing.sid !== sid) closeEditor();
      ui.annotate.hidden = true;
      selTarget = null;
    }
    if (drawnFor !== sid) { render(); return; }
    if (ensure()) { labelsDirty = true; paint(); }
  }

  const onStorage = (e) => {
    if (typeof e?.key === 'string' && e.key.startsWith(KEY_PREFIX)) {
      store.forget(e.key.slice(KEY_PREFIX.length));
      render();
    } else if (typeof e?.key === 'string' && e.key.startsWith(SENT_PREFIX)) {
      store.forgetSent(e.key.slice(SENT_PREFIX.length));
      render();
    }
  };

  doc.addEventListener('mouseup', deferSelection);
  doc.addEventListener('keyup', deferSelection);
  doc.addEventListener('selectionchange', onSelectionChange);
  win.addEventListener?.('resize', schedulePaint);
  win.addEventListener?.('storage', onStorage);
  offs.push(store.onChange((changed) => { if (changed === sid) render(); }));
  try { offs.push(source.watch?.(refresh)); } catch { /* fine */ }
  // The panel's nodes may not exist when the board half loads, and the
  // session can change without a front change reaching us on an older board:
  // a slow tick keeps both honest.
  const tick = win.setInterval(() => { if (!panel || !panel.wrap.isConnected || keyNow() !== sid) refresh(); }, 1000);

  refresh();

  return {
    refresh,
    sendAll,
    openEditor,
    get sessionId() { return sid; },
    destroy() {
      win.clearInterval(tick);
      win.clearTimeout(flashTimer);
      doc.removeEventListener('mouseup', deferSelection);
      doc.removeEventListener('keyup', deferSelection);
      doc.removeEventListener('selectionchange', onSelectionChange);
      win.removeEventListener?.('resize', schedulePaint);
      win.removeEventListener?.('storage', onStorage);
      for (const off of offs) { try { off?.(); } catch { /* fine */ } }
      streamObserver?.disconnect();
      panel?.stream.removeEventListener('scroll', schedulePaint);
      if (panel) for (const [type, fn] of popEvents) panel.stream.removeEventListener(type, fn);
      if (panel) labelReplies(panel.stream, [], source.entries ? { entries: source.entries } : undefined);
      if (panel?.positionHost) panel.host.classList.remove('aw-annot-host');
      for (const n of Object.values(ui)) n.remove();
      lendHighlights(win, owner, null, null);
    },
  };
}
