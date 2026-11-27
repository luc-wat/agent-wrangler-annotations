// Wrangler²'s own chats as its public/job-thread.js, job-talk.js and
// job-ask-box.js draw them (the parts this extension reads), on a step's page,
// plus a fake of jobs-view.js's wiring of the Add idea box: typing enables its
// Send, Send takes the words, empties the box and draws the whole page again,
// as every change in Wrangler² does.
import { makeWindow } from './fixture.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const threadMsg = (m) => m.from === 'agent'
  ? `<div class="job-msg agent"><span class="job-msg-who">Session</span><div><div class="job-msg-text chat-prose">${m.html}</div><time>${esc(m.at)}</time></div></div>`
  : m.from === 'system'
    ? `<div class="job-msg system"><span class="job-msg-who">Round ${esc(m.round)}</span><div><p class="job-msg-text">${esc(m.text)}</p><time>${esc(m.at)}</time></div></div>`
    : `<div class="job-msg human"><span class="job-msg-who">You</span><div><p class="job-msg-text">${esc(m.text)}</p><time>${esc(m.at)}<i class="job-msg-tick"><svg></svg></i></time><span class="job-msg-via">via Wrangler</span></div></div>`;

const talkMsg = (m) => m.from === 'human'
  ? `<div class="job-sent" data-talk="${esc(m.id)}"><div class="job-sent-bubble"><span>${esc(m.text)}</span></div><span class="job-sent-meta">You · ${esc(m.at)}</span></div>`
  : m.from === 'session'
    ? `<div class="job-talk-session" data-talk-thread="${esc(m.id)}"><span class="job-talk-session-mark"><svg></svg></span><div><div class="job-idea-who">Session<time>${esc(m.at)}</time></div><div class="job-idea-body chat-prose">${m.html}</div></div></div>`
    : `<div class="job-idea-msg job-talk-msg" data-talk="${esc(m.id)}"><svg class="wn-mark"></svg><div><div class="job-idea-who">Wrangler<time>${esc(m.at)}</time></div><div class="job-idea-body chat-prose job-answer"><div class="job-answer-lead">${m.html}</div></div></div></div>`;

const boxHtml = (convo, draft) => `<div class="job-change" data-change-convo="${esc(convo)}" data-change-to="Wrangler">
  <ul class="job-change-tray" hidden></ul><p class="job-change-error" role="alert" hidden></p>
  <div class="job-change-row"><span class="job-change-to">Wrangler${convo ? '<small>↩ Review notes</small>' : ''}</span><textarea rows="1" maxlength="8000" placeholder="Reply in this conversation…">${esc(draft)}</textarea><label class="job-change-attach"><input type="file" multiple></label><button type="button" class="job-change-go" data-change-send ${draft ? '' : 'disabled'}>Send</button></div>
  <div class="job-change-foot"><kbd>↵ send · ⇧↵ new line</kbd></div></div>`;

export function pageHtml(s) {
  const thread = s.thread.length
    ? `<details class="job-more job-history waiting" data-keep="history" open><summary>Conversation <small>${s.thread.length} messages</small></summary><section class="job-thread waiting" aria-label="Conversation with the session">${s.thread.map(threadMsg).join('')}</section></details>`
    : '';
  const convos = s.convos.map((c) => {
    const head = `<header class="job-talk-convo-head" data-convo-fold><b>${esc(c.title)}</b><span class="job-talk-convo-tools"><button type="button" class="job-talk-fold">v</button></span></header>`;
    if (c.folded) return `<div class="job-talk-convo is-folded" data-convo="${esc(c.id)}">${head}</div>`;
    const box = s.reply ? boxHtml(c.id, s.drafts[c.id] || '') : '';
    return `<div class="job-talk-convo" data-convo="${esc(c.id)}">${head}${c.messages.map(talkMsg).join('')}${box}<div class="job-talk-convo-foot"><button type="button" class="job-talk-collapse" data-convo-collapse>Collapse</button></div></div>`;
  }).join('');
  const talk = s.convos.length ? `<section class="job-talk" data-talk-target aria-label="Conversations with Wrangler"><h4 class="job-talk-head">Conversation with Wrangler</h4>${convos}</section>` : '';
  // No conversation open to write in: the box below them all starts a new one.
  const loose = s.reply && !s.convos.some((c) => !c.folded) ? boxHtml('', s.drafts[''] || '') : '';
  return `<header class="job-appbar"><h2>${esc(s.title)}</h2></header><div class="job-tabpanel">${thread}</div>${talk}${loose}<div class="job-actions"><button class="primary">Approve</button></div>`;
}

// A window with the board's Chat panel (fixture.js) and Wrangler²'s job page.
export function makeW2Window(state) {
  const window = makeWindow();
  const { document } = window;
  document.querySelector('.ext-view').insertAdjacentHTML('beforeend', '<section id="job-page" class="job-page"><nav class="job-page-bar"></nav><div class="job-page-main"></div></section>');
  const view = createFakeView(document, state);
  return { window, document, view };
}

export function createFakeView(document, state) {
  const s = { title: 'Annotations in Wrangler² chats', thread: [], convos: [], drafts: {}, reply: true, uploading: false, ...state };
  const sent = [];
  const main = () => document.querySelector('.job-page-main');
  function draw() {
    main().innerHTML = pageHtml(s);
    for (const box of main().querySelectorAll('.job-change')) {
      const text = box.querySelector('textarea');
      const go = box.querySelector('[data-change-send]');
      const key = box.dataset.changeConvo || '';
      const sync = () => { go.disabled = !text.value.trim() || s.uploading; };
      text.addEventListener('input', () => { sync(); if (text.value) s.drafts[key] = text.value; else delete s.drafts[key]; });
      sync();
      go.onclick = () => {
        if (!text.value.trim() || go.disabled) return;
        sent.push({ convo: key, text: text.value.trim() });
        text.value = '';
        delete s.drafts[key];
        draw();
      };
    }
  }
  draw();
  return { state: s, sent, draw, main };
}

// Select `text` (its nth occurrence) inside `root` as a drag would.
export function selectIn(window, root, text, nth = 0) {
  const { document } = window;
  const walker = document.createTreeWalker(root, 4);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (let i = node.data.indexOf(text); i !== -1; i = node.data.indexOf(text, i + 1)) {
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
    }
  }
  throw new Error(`"${text}" #${nth} not in ${root.className || root.id}`);
}

// A step on Code review: the session's thread, and one open conversation with the
// wrangler in which a forward was answered by that session.
export const REVIEW = () => ({
  thread: [
    { from: 'human', text: 'Does the tray survive a reload?', at: '10:02' },
    { from: 'agent', html: '<p>Yes. Notes are kept in localStorage per conversation.</p><p>The marks come back when the chat redraws.</p>', at: '10:05' },
  ],
  convos: [{
    id: 'cv1',
    title: 'Review notes',
    messages: [
      { id: 'm1', from: 'human', text: 'Why a second adapter?', at: '10:00' },
      { id: 'm2', from: 'wrangler', html: '<p>Because Wrangler² draws these chats itself.</p><p>Core’s panel is only lent for idea conversations.</p>', at: '10:01' },
    ],
  }],
});
