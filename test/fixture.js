// Core's session panel as public/index.html draws it (the parts this extension
// touches), in a happy-dom window, plus helpers to move it the way
// api.mountSession does and to fake the extension api.
import { Window } from 'happy-dom';

export const BOARD_HTML = `
<main>
  <aside id="sidebar">
    <div id="panel"></div>
    <div id="panel-sections"></div>
    <div id="term-wrap" hidden><div id="term"></div></div>
    <div id="chat-wrap">
      <div id="chat-stream-wrap" class="chat-stream-wrap">
        <div id="chat-stream" class="chat-stream" aria-live="polite"></div>
        <div id="chat-jump-nav" class="chat-jump-nav" hidden></div>
      </div>
      <div id="chat-exit-notice" class="chat-exit-notice" hidden></div>
      <div id="chat-composer" class="chat-composer">
        <div class="chat-box"><textarea id="chat-input" rows="1"></textarea><button type="button" id="chat-send">Send</button></div>
      </div>
    </div>
  </aside>
  <div class="ext-view" id="ext-view-jobs">
    <section id="jobs"><div class="job-mc"><div class="job-mc-host"></div></div></section>
  </div>
</main>`;

export function makeWindow() {
  const window = new Window({ url: 'http://localhost/' });
  window.document.body.innerHTML = BOARD_HTML;
  return window;
}

// Chat events as chat-dom.js renders them.
export function renderChat(document, messages) {
  const stream = document.getElementById('chat-stream');
  stream.replaceChildren();
  for (const m of messages) {
    const wrap = document.createElement('div');
    if (m.user) {
      wrap.className = 'chat-user';
      wrap.textContent = m.user;
    } else {
      wrap.className = 'chat-assistant';
      const prose = document.createElement('div');
      prose.className = 'chat-prose';
      prose.innerHTML = m.html;
      wrap.append(prose);
    }
    stream.append(wrap);
  }
  return stream;
}

// api.mountSession moves #sidebar's panel nodes into the extension's element.
export function lendTo(document, host) {
  const sidebar = document.getElementById('sidebar');
  host.append(sidebar);
  sidebar.classList.add('session-embed');
}

// type() behaves as core's composer does: `text` goes at the END of whatever is
// in #chat-input, and a submit sends the whole box and empties it. `typed`
// records what each submit actually sent.
export function fakeApi({ session = 's1', panel = 'chat', document = null } = {}) {
  const fns = new Set();
  const b = {
    front: { view: 'grid', ext: null, dialog: null, menu: false, session, panel },
    typed: [],
    toasts: [],
    refuse: null,
  };
  b.api = {
    front: Object.assign(() => ({ ...b.front }), { onChange: (fn) => { fns.add(fn); return () => fns.delete(fn); } }),
    sessionPanel: {
      view: () => b.front.panel,
      type: (text, o) => {
        if (b.refuse) return { ok: false, reason: b.refuse };
        const input = document?.getElementById('chat-input');
        if (input) {
          input.value += text;
          if (!o?.submit) return { ok: true, view: b.front.panel, submitted: false };
          text = input.value.trim();
          input.value = '';
        }
        b.typed.push({ session: b.front.session, text, submit: !!o?.submit });
        return { ok: true, view: b.front.panel, submitted: !!o?.submit };
      },
    },
    ui: { toast: (t) => { b.toasts.push(t); return true; } },
  };
  b.show = (f) => { b.front = { ...b.front, ...f }; for (const fn of [...fns]) fn({ ...b.front }); };
  return b;
}

// Select `text` (its nth occurrence) inside the stream as a drag would.
export function selectText(window, text, nth = 0) {
  const { document } = window;
  const stream = document.getElementById('chat-stream');
  const walker = document.createTreeWalker(stream, 4);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let from = 0;
    for (let i = node.data.indexOf(text, from); i !== -1; i = node.data.indexOf(text, from)) {
      if (seen === nth) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + text.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return r;
      }
      seen += 1;
      from = i + 1;
    }
  }
  throw new Error(`"${text}" #${nth} not in the stream`);
}

// happy-dom has no CSS Custom Highlight API: a stand-in that keeps each
// highlight's ranges, so a test can read what is marked (and flashed).
export function fakeHighlights(window) {
  const highlights = new Map();
  window.Highlight = class { constructor(...ranges) { this.ranges = ranges; } };
  // happy-dom hands out a new CSS object on every read.
  const css = Object.assign(Object.create(window.CSS || null), { highlights });
  Object.defineProperty(window, 'CSS', { value: css, configurable: true });
  return {
    highlights,
    flashed: () => (highlights.get('aw-annotation-focus')?.ranges || []).map((r) => r.toString()),
    flashedIn: () => (highlights.get('aw-annotation-focus')?.ranges || []).map((r) => r.startContainer.parentElement),
  };
}
