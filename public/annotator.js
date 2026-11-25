// The annotation UI on core's Chat panel: an "Annotate" button over a fresh
// selection, a note editor, the marks (CSS highlights plus numbered pins) and
// the tray listing every note with Edit and Remove, and Send all.
//
// Everything is drawn INSIDE the panel's own nodes (#chat-stream-wrap and
// #chat-wrap), never on <body>: api.mountSession moves those nodes into a
// Wrangler² view, which may sit in a modal <dialog>, and anything outside it
// would be inert there. Moving the panel moves our nodes with it.
//
// The session is the one the panel shows, read from api.front().session; the
// board selects the session it lends, so this holds on the board and in every
// Wrangler² view alike. Send all types through api.sessionPanel.type, which
// writes into that same panel's composer and sends it.
//
// What was sent is kept (store.recordSent), and the agent's "Re note N:" labels
// in its replies become chips whose hover card shows that note (replies.js).

import { composeMessage, sentItems, tidyQuote } from './compose.js';
import { findChatPanel, selectionTarget, locate } from './panel.js';
import { labelReplies } from './replies.js';
import { KEY_PREFIX, SENT_PREFIX } from './store.js';

const HL = 'aw-annotation';
const HL_FOCUS = 'aw-annotation-focus';
const COLLAPSED_KEY = 'aw-annotations:tray-collapsed';

const REFUSALS = {
  'no-panel': 'Open the session’s Chat to send your notes.',
  gated: 'This session is locked, so nothing can be typed into it.',
  blocked: 'The session is waiting on a prompt in its Terminal; answer it first.',
  'not-sent': 'The message is in the box but did not send (no connection?). Press Send, then Clear the notes.',
  capability: 'Agent Wrangler refused typing into the session (session:type).',
};

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

export function createAnnotator({ document: doc = globalThis.document, api = null, store, storage = globalThis.localStorage, toast = null } = {}) {
  const win = doc.defaultView || globalThis;
  let panel = null;
  let sid = null;
  let editing = null; // { id|null, target? } while the new-note editor is open
  let editingItem = null; // the tray item whose note is being edited
  let selTarget = null;
  let flashId = null; // a passage just revealed from the tray, drawn in the focus colour briefly
  let flashTimer = 0;
  let frame = 0;
  let labelsDirty = true;
  let popChip = null;
  let collapsed = false;
  try { collapsed = storage?.getItem(COLLAPSED_KEY) === '1'; } catch { /* default open */ }
  const offs = [];

  const ui = {
    layer: el(doc, 'div', 'aw-annot-layer'),
    annotate: el(doc, 'button', 'aw-annot-add'),
    editor: el(doc, 'form', 'aw-annot-editor'),
    tray: el(doc, 'section', 'aw-annot-tray'),
    pop: el(doc, 'div', 'aw-annot-reply-pop'),
  };
  ui.pop.hidden = true;
  ui.pop.id = 'aw-annot-reply-pop';
  ui.pop.setAttribute('role', 'tooltip');
  ui.layer.setAttribute('aria-hidden', 'true');
  ui.annotate.type = 'button';
  ui.annotate.innerHTML = `${PEN}<span>Annotate</span>`;
  ui.annotate.title = 'Add a note on this passage';
  ui.annotate.hidden = true;
  ui.editor.hidden = true;
  ui.tray.hidden = true;
  ui.tray.setAttribute('aria-label', 'Annotations');

  // The selection is kept while the button is pressed.
  ui.annotate.addEventListener('mousedown', (e) => e.preventDefault());
  ui.annotate.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selTarget) openEditor(selTarget);
  });

  const sessionNow = () => {
    try { return api?.front?.()?.session || null; } catch { return null; }
  };

  // Attach our nodes to the panel (once: core's panel nodes are never rebuilt,
  // only moved). Returns the panel or null.
  function ensure() {
    const p = findChatPanel(doc);
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
    if (ui.layer.parentNode !== p.streamWrap) p.streamWrap.append(ui.layer);
    if (ui.annotate.parentNode !== p.streamWrap) p.streamWrap.append(ui.annotate);
    if (ui.editor.parentNode !== p.streamWrap) p.streamWrap.append(ui.editor);
    if (ui.pop.parentNode !== p.streamWrap) p.streamWrap.append(ui.pop);
    if (ui.tray.parentNode !== p.wrap) p.wrap.insertBefore(ui.tray, p.composer || null);
    return p;
  }

  const onStreamChange = () => { labelsDirty = true; schedulePaint(); };
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
    const box = p.streamWrap.getBoundingClientRect();
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
    const target = sessionNow() ? selectionTarget(sel, p.stream) : null;
    selTarget = target;
    if (!target) { ui.annotate.hidden = true; return; }
    const rects = target.range.getClientRects?.() || [];
    const last = rects.length ? rects[rects.length - 1] : target.range.getBoundingClientRect?.();
    const box = p.streamWrap.getBoundingClientRect();
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
    const at = sessionNow();
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
    const wrapBox = p.streamWrap.getBoundingClientRect();
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
    return store.list(sid).map((a, i) => ({ a, n: i + 1, range: locate(panel.stream, a.anchor, a.occurrence) }));
  }

  function paint() {
    const highlights = win.CSS?.highlights;
    const Highlight = win.Highlight;
    const located = rangesNow();
    const focusId = editingItem || flashId;
    if (highlights && typeof Highlight === 'function') {
      const all = located.filter((x) => x.range && x.a.id !== focusId).map((x) => x.range);
      if (editing?.target?.range) all.push(editing.target.range);
      const focus = located.filter((x) => x.range && x.a.id === focusId).map((x) => x.range);
      highlights.set(HL, new Highlight(...all));
      highlights.set(HL_FOCUS, new Highlight(...focus));
    }
    ui.layer.replaceChildren();
    if (!panel) return;
    if (labelsDirty) {
      labelsDirty = false;
      labelReplies(panel.stream, sid ? store.sent(sid) : []);
      if (popChip && !popChip.isConnected) hidePop();
      streamObserver?.takeRecords?.();
    }
    const box = panel.streamWrap.getBoundingClientRect();
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
    const r = hit.range.getBoundingClientRect();
    const v = panel.stream.getBoundingClientRect();
    panel.stream.scrollTop += r.top - v.top - v.height / 3;
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
  function render() {
    const p = ensure();
    if (!p) return;
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
    send.title = 'Send every note to this session as one message';
    head.append(toggle, el(doc, 'span', 'aw-annot-spacer'), clear, send);
    ui.tray.append(head);
    if (collapsed) { paint(); return; }

    const ol = el(doc, 'ol', 'aw-annot-list');
    list.forEach((a, i) => ol.append(itemNode(a, i + 1)));
    ui.tray.append(ol);
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

  function sendAll() {
    const at = sessionNow();
    const list = at ? store.list(at) : [];
    if (!at || at !== sid || !list.length) return { ok: false, reason: 'no-session' };
    if (editingItem) { toastOf('Save or cancel the note you are editing first.', 'warning'); return { ok: false, reason: 'editing' }; }
    const p = ensure();
    if (p?.input && p.input.value.trim()) {
      toastOf('The message box already has text in it. Send or clear it first, so your notes go on their own.', 'warning');
      return { ok: false, reason: 'draft' };
    }
    if (typeof api?.sessionPanel?.type !== 'function') {
      toastOf('This Agent Wrangler cannot type into a session (host API 1.68 or later is needed).', 'error');
      return { ok: false, reason: 'unsupported' };
    }
    const text = composeMessage(list);
    const r = api.sessionPanel.type(text, { submit: true }) || { ok: false, reason: 'no-panel' };
    if (r.ok && r.submitted) {
      store.recordSent(at, { text, items: sentItems(list) });
      store.clear(at);
      toastOf(`Sent ${list.length} ${list.length === 1 ? 'note' : 'notes'} to the session.`, 'success');
    } else {
      toastOf(REFUSALS[r.reason] || `Not sent (${r.reason || 'unknown'}).`, 'error');
    }
    return r;
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  function refresh() {
    const next = sessionNow();
    if (next !== sid) {
      sid = next;
      editingItem = null;
      if (editing && editing.sid !== sid) closeEditor();
      ui.annotate.hidden = true;
      selTarget = null;
    }
    render();
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
  if (typeof api?.front?.onChange === 'function') offs.push(api.front.onChange(refresh));
  // The panel's nodes may not exist when the board half loads, and the
  // session can change without a front change reaching us on an older board:
  // a slow tick keeps both honest.
  const tick = win.setInterval(() => { if (!panel || !panel.wrap.isConnected || sessionNow() !== sid) refresh(); }, 1000);

  refresh();

  return {
    refresh,
    sendAll,
    openEditor,
    get sessionId() { return sid; },
    destroy() {
      win.clearInterval(tick);
      doc.removeEventListener('mouseup', deferSelection);
      doc.removeEventListener('keyup', deferSelection);
      doc.removeEventListener('selectionchange', onSelectionChange);
      win.removeEventListener?.('resize', schedulePaint);
      win.removeEventListener?.('storage', onStorage);
      for (const off of offs) { try { off?.(); } catch { /* fine */ } }
      streamObserver?.disconnect();
      panel?.stream.removeEventListener('scroll', schedulePaint);
      if (panel) for (const [type, fn] of popEvents) panel.stream.removeEventListener(type, fn);
      if (panel) labelReplies(panel.stream, []);
      for (const n of Object.values(ui)) n.remove();
      win.CSS?.highlights?.delete(HL);
      win.CSS?.highlights?.delete(HL_FOCUS);
    },
  };
}
