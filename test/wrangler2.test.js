import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotator } from '../public/annotator.js';
import { createStore } from '../public/store.js';
import { createWrangler2Annotations, findConversations, threadKey, boxFor, BOX_MAX } from '../public/wrangler2.js';
import { renderChat, fakeApi, selectText } from './fixture.js';
import { makeW2Window, selectIn, REVIEW } from './w2-fixture.js';

const settle = (window) => new Promise((r) => window.setTimeout(r, 40));

function setup(state = REVIEW(), { storage, board = true } = {}) {
  const { window, document, view } = makeW2Window(state);
  storage ||= window.localStorage;
  const store = createStore({ storage });
  const api = fakeApi({ session: 's1', document });
  const w2 = createWrangler2Annotations({ document, api: api.api, store, storage });
  const chat = board ? createAnnotator({ document, api: api.api, store, storage }) : null;
  return { window, document, view, store, storage, api, w2, chat, destroy: () => { w2.destroy(); chat?.destroy(); } };
}

const thread = (d) => d.querySelector('section.job-thread');
const convo = (d, id = 'cv1') => d.querySelector(`.job-talk-convo[data-convo="${id}"]`);

async function annotate(t, root, text, note, nth = 0) {
  selectIn(t.window, root(), text, nth);
  t.document.dispatchEvent(new t.window.MouseEvent('mouseup', { bubbles: true }));
  await settle(t.window);
  const add = [...t.document.querySelectorAll('.aw-annot-add')].find((b) => !b.hidden);
  assert.ok(add, 'an Annotate button shows over the selection');
  add.click();
  const editor = [...t.document.querySelectorAll('.aw-annot-editor')].find((e) => !e.hidden);
  assert.ok(editor, 'the note editor opens');
  editor.querySelector('textarea').value = note;
  editor.querySelector('button[type=submit]').click();
  assert.equal(editor.hidden, true);
  await settle(t.window);
}

const items = (root) => [...root.querySelectorAll('.aw-annot-item')].map((li) => ({
  quote: li.querySelector('.aw-annot-quote').textContent,
  note: li.querySelector('.aw-annot-note')?.textContent,
}));

test('finds a step\'s thread and each open conversation with the wrangler; nothing without that markup', () => {
  const { document, view } = makeW2Window(REVIEW());
  const found = findConversations(document);
  assert.deepEqual(found.map((c) => c.kind), ['thread', 'talk']);
  assert.match(found[0].key, /^w2:thread:[0-9a-z]+$/);
  assert.equal(found[1].key, 'w2:talk:cv1');

  // The thread's key holds across redraws and new messages, and differs per step.
  const key = threadKey(thread(document));
  view.state.thread.push({ from: 'agent', html: '<p>More.</p>', at: '10:09' });
  view.draw();
  assert.equal(threadKey(thread(document)), key);
  view.state.title = 'Another step';
  view.draw();
  assert.notEqual(threadKey(thread(document)), key);

  // A folded conversation is its title row alone, and an empty thread has nothing to annotate.
  view.state.convos[0].folded = true;
  view.state.thread = [];
  view.draw();
  assert.deepEqual(findConversations(document), []);

  // The board alone, or a document with none of it, finds nothing and throws nothing.
  const bare = makeW2Window(REVIEW()).document;
  bare.querySelector('#job-page').remove();
  assert.deepEqual(findConversations(bare), []);
});

test('the Add idea box: an open conversation\'s own, and for a thread its step\'s', () => {
  const { document, view } = makeW2Window(REVIEW());
  assert.equal(boxFor(convo(document), 'talk').dataset.changeConvo, 'cv1');
  assert.equal(boxFor(thread(document), 'thread').dataset.changeConvo, 'cv1');
  view.state.reply = false;
  view.draw();
  assert.equal(boxFor(convo(document), 'talk'), null);
  assert.equal(boxFor(thread(document), 'thread'), null);
});

test('highlight and note in the session\'s thread: marks, tray and editor are drawn inside that conversation', async () => {
  const t = setup();
  await annotate(t, () => thread(t.document), 'kept in localStorage', 'Which key?');
  await annotate(t, () => thread(t.document), 'when the chat redraws', 'And after a reload?');
  const tray = thread(t.document).querySelector('.aw-annot-tray');
  assert.ok(tray && !tray.hidden, 'the tray is the thread\'s last row');
  assert.ok(tray.classList.contains('aw-annot-w2') && tray.classList.contains('aw-annot-w2-thread'), 'one class token each');
  assert.equal(tray.querySelector('.aw-annot-title').textContent, '2 notes');
  assert.deepEqual(items(tray).map((i) => i.note), ['Which key?', 'And after a reload?']);
  assert.match(tray.querySelector('.aw-annot-foot').textContent, /Add idea box/);
  const host = thread(t.document).parentElement;
  assert.ok(host.classList.contains('aw-annot-host'), 'the thread\'s parent holds the floating parts');
  assert.ok(host.querySelector(':scope > .aw-annot-editor') && host.querySelector(':scope > .aw-annot-layer'));

  // Kept per conversation: never under a session's key, and the board's Chat tray stays empty.
  const key = threadKey(thread(t.document));
  assert.equal(JSON.parse(t.storage.getItem(`aw-annotations:v1:${key}`)).length, 2);
  assert.equal(t.storage.getItem('aw-annotations:v1:s1'), null);
  assert.equal(t.document.querySelector('#chat-wrap .aw-annot-tray').hidden, true);
  t.destroy();
});

test('Wrangler² drawing the page again keeps the tray, the notes and a note being written', async () => {
  const t = setup();
  await annotate(t, () => thread(t.document), 'kept in localStorage', 'Which key?');
  selectIn(t.window, thread(t.document), 'Notes are kept');
  t.document.dispatchEvent(new t.window.MouseEvent('mouseup', { bubbles: true }));
  await settle(t.window);
  [...t.document.querySelectorAll('.aw-annot-add')].find((b) => !b.hidden).click();
  const editor = [...t.document.querySelectorAll('.aw-annot-editor')].find((e) => !e.hidden);
  editor.querySelector('textarea').value = 'half a thought';

  t.view.draw(); // every change on a job redraws its page from scratch
  await settle(t.window);
  const tray = thread(t.document).querySelector('.aw-annot-tray');
  assert.ok(tray, 'the tray is back in the new thread');
  assert.deepEqual(items(tray).map((i) => i.note), ['Which key?']);
  assert.ok(thread(t.document).parentElement.contains(editor), 'the open editor moved with it');
  assert.equal(editor.querySelector('textarea').value, 'half a thought');
  t.destroy();
});

test('Send all from the thread fills the step\'s Add idea box, draft at the foot, and sends it', async () => {
  const t = setup();
  await annotate(t, () => thread(t.document), 'kept in localStorage', 'Which key?');
  await annotate(t, () => thread(t.document), 'when the chat redraws', '');
  const box = t.document.querySelector('.job-change textarea');
  box.value = 'Otherwise ship it.';
  box.dispatchEvent(new t.window.Event('input', { bubbles: true }));
  thread(t.document).querySelector('.aw-annot-send').click();

  assert.equal(t.view.sent.length, 1, 'one idea, sent through the box\'s own Send');
  assert.equal(t.view.sent[0].convo, 'cv1');
  assert.equal(t.view.sent[0].text, 'I have notes on 2 passages of this conversation:\n\n1. > kept in localStorage\n\n   Which key?\n\n2. > when the chat redraws\n\nPlease answer each note in turn and start each answer with its label ("Re note 1:", "Re note 2:" and so on) so I can tell which note it answers.\n\nOtherwise ship it.');
  assert.equal(t.api.typed.length, 0, 'nothing is typed into a session');
  await settle(t.window);
  assert.equal(t.document.querySelector('.job-change textarea').value, '', 'the box is empty');
  assert.equal(thread(t.document).querySelector('.aw-annot-tray').hidden, true, 'the notes are cleared');
  const key = threadKey(thread(t.document));
  assert.equal(t.store.sent(key).at(-1).text, t.view.sent[0].text, 'the batch is recorded for the chips');
  assert.equal(t.api.toasts.at(-1).severity, 'success');
  t.destroy();
});

test('a note on the wrangler\'s answer goes through that conversation\'s own box; the tray sits above it', async () => {
  const t = setup();
  await annotate(t, () => convo(t.document), 'draws these chats itself', 'Is that stable?');
  const c = convo(t.document);
  const tray = c.querySelector('.aw-annot-tray');
  assert.ok(tray && tray.nextElementSibling.matches('.job-change'), 'the tray sits right above the Add idea box');
  assert.ok(c.classList.contains('aw-annot-host'));
  assert.equal(JSON.parse(t.storage.getItem('aw-annotations:v1:w2:talk:cv1')).length, 1);
  assert.equal(thread(t.document).querySelector('.aw-annot-tray').hidden, true, 'the thread has its own (empty) list');
  c.querySelector('.aw-annot-send').click();
  assert.equal(t.view.sent.length, 1);
  assert.equal(t.view.sent[0].convo, 'cv1');
  assert.match(t.view.sent[0].text, /^I have a note on one passage of this conversation:\n\n1\. > draws these chats itself\n\n {3}Is that stable\?/);
  t.destroy();
});

test('the header, the box and our own tray are never part of the conversation\'s text', async () => {
  const t = setup();
  selectIn(t.window, convo(t.document), 'Review notes'); // the conversation's title row
  t.document.dispatchEvent(new t.window.MouseEvent('mouseup', { bubbles: true }));
  await settle(t.window);
  assert.ok([...t.document.querySelectorAll('.aw-annot-add')].every((b) => b.hidden));

  // An excerpt is found again after notes appear in the tray between messages and box.
  await annotate(t, () => convo(t.document), 'only lent', 'Only?');
  await annotate(t, () => convo(t.document), 'Because', 'Why?');
  assert.deepEqual(items(convo(t.document)).map((i) => i.quote), ['only lent', 'Because']);
  assert.equal([...convo(t.document).querySelectorAll('.aw-annot-item.offscreen')].length, 0, 'both passages are found');
  t.destroy();
});

test('a send Wrangler² does not take keeps the notes and puts the draft back', async () => {
  const t = setup();
  await annotate(t, () => thread(t.document), 'kept in localStorage', 'Which key?');
  const draft = () => t.document.querySelector('.job-change textarea');

  // A picture still uploading holds the box's Send.
  t.view.state.uploading = true;
  draft().value = 'my draft';
  thread(t.document).querySelector('.aw-annot-send').click();
  assert.equal(t.view.sent.length, 0);
  assert.equal(draft().value, 'my draft');
  assert.match(t.api.toasts.at(-1).text, /uploading/);
  assert.equal(items(thread(t.document)).length, 1);

  // Too long for the box.
  t.view.state.uploading = false;
  t.store.add(threadKey(thread(t.document)), { quote: 'x', anchor: 'x', note: 'y'.repeat(BOX_MAX) });
  await settle(t.window);
  thread(t.document).querySelector('.aw-annot-send').click();
  assert.equal(t.view.sent.length, 0);
  assert.match(t.api.toasts.at(-1).text, /8,000 characters/);
  assert.equal(draft().value, 'my draft');

  // No box here at all.
  t.view.state.reply = false;
  t.view.draw();
  await settle(t.window);
  thread(t.document).querySelector('.aw-annot-send').click();
  assert.match(t.api.toasts.at(-1).text, /takes no reply here/);
  assert.equal(items(thread(t.document)).length, 2);
  t.destroy();
});

test('"Re note N:" in the session\'s answer, in the thread and in the conversation, becomes a chip with a hover card', async () => {
  const t = setup();
  await annotate(t, () => thread(t.document), 'kept in localStorage', 'Which key?');
  await annotate(t, () => thread(t.document), 'when the chat redraws', 'And after a reload?');
  thread(t.document).querySelector('.aw-annot-send').click();
  const sent = t.view.sent[0].text;

  // The planner forwards the words unchanged; the session answers in its thread,
  // and the forward's answer shows in the conversation too.
  t.view.state.thread.push({ from: 'human', text: sent, at: '10:12' }, { from: 'agent', html: '<p><strong>Re note 1:</strong> <code>aw-annotations:v1:w2:…</code>.</p><p>Re note 2: yes, they come back.</p>', at: '10:15' });
  t.view.draw();
  await settle(t.window); await settle(t.window);
  const chips = () => [...thread(t.document).querySelectorAll('.aw-annot-reply')];
  assert.deepEqual(chips().map((c) => c.textContent), ['Re note 1', 'Re note 2']);
  assert.deepEqual(chips().map((c) => c.dataset.note), ['Which key?', 'And after a reload?']);

  chips()[1].dispatchEvent(new t.window.MouseEvent('mouseover', { bubbles: true }));
  const pop = thread(t.document).parentElement.querySelector(':scope > .aw-annot-reply-pop');
  assert.equal(pop.hidden, false, 'the card shows inside the step');
  assert.match(pop.textContent, /when the chat redraws/);
  assert.match(pop.textContent, /And after a reload\?/);
  chips()[1].dispatchEvent(new t.window.MouseEvent('mouseout', { bubbles: true }));
  assert.equal(pop.hidden, true);

  // The forward's answer shows in the conversation with the wrangler as well.
  t.view.state.convos[0].messages.push({ id: 'm3', from: 'human', text: sent, at: '10:12' }, { id: 't1', from: 'session', html: '<p>Re note 2: they come back.</p>', at: '10:15' });
  t.view.draw();
  await settle(t.window); await settle(t.window);
  assert.deepEqual([...convo(t.document).querySelectorAll('.aw-annot-reply')].map((c) => c.dataset.note), ['And after a reload?']);

  // In a conversation with the wrangler: what was sent there, and the answers after it.
  await annotate(t, () => convo(t.document), 'draws these chats itself', 'Stable?');
  convo(t.document).querySelector('.aw-annot-send').click();
  const said = t.view.sent[1].text;
  t.view.state.convos[0].messages.push(
    { id: 'm5', from: 'human', text: said, at: '10:20' },
    { id: 'm4', from: 'wrangler', html: '<p>Re note 1: yes, its markup is versioned with it.</p>', at: '10:21' },
    { id: 't9', from: 'session', html: '<p>Re note 1: and I tested it.</p>', at: '10:23' },
  );
  t.view.draw();
  await settle(t.window); await settle(t.window);
  const talkChips = [...convo(t.document).querySelectorAll('.aw-annot-reply')];
  assert.equal(talkChips.length, 3, 'the wrangler\'s and the session\'s answers both get a chip');
  assert.deepEqual(talkChips.map((c) => c.dataset.note), ['And after a reload?', 'Stable?', 'Stable?'], 'each from the batch it answers');
  assert.equal(convo(t.document).querySelectorAll('.job-sent .aw-annot-reply').length, 0, 'never in what the human sent');
  t.destroy();
  assert.equal(t.document.querySelectorAll('.aw-annot-reply').length, 0, 'destroy takes the chips out');
});

test('notes survive leaving the step and a reload; leaving takes every node out', async () => {
  const t = setup();
  await annotate(t, () => convo(t.document), 'only lent', 'Only?');
  t.view.main().innerHTML = ''; // back to the board
  await settle(t.window);
  assert.deepEqual(t.w2.keys, []);
  assert.equal(t.document.querySelectorAll('.job-page-main .aw-annot-ui').length, 0);
  t.view.draw();
  await settle(t.window);
  assert.deepEqual(items(convo(t.document)).map((i) => i.note), ['Only?']);
  t.destroy();

  const again = setup(REVIEW(), { storage: t.storage });
  assert.deepEqual(items(convo(again.document)).map((i) => i.note), ['Only?']);
  again.destroy();
});

test('the board\'s Chat works as before beside them, with its own notes', async () => {
  const t = setup();
  renderChat(t.document, [{ user: 'Plan it.' }, { html: '<p>First we add the column.</p>' }]);
  selectText(t.window, 'add the column');
  t.document.dispatchEvent(new t.window.MouseEvent('mouseup', { bubbles: true }));
  await settle(t.window);
  t.document.querySelector('#chat-stream-wrap > .aw-annot-add').click();
  const editor = t.document.querySelector('#chat-stream-wrap > .aw-annot-editor');
  editor.querySelector('textarea').value = 'Which type?';
  editor.querySelector('button[type=submit]').click();
  await annotate(t, () => thread(t.document), 'kept in localStorage', 'Which key?');

  assert.deepEqual(items(t.document.getElementById('chat-wrap')).map((i) => i.note), ['Which type?']);
  assert.deepEqual(items(thread(t.document)).map((i) => i.note), ['Which key?']);
  t.document.querySelector('#chat-wrap .aw-annot-send').click();
  assert.equal(t.api.typed.length, 1, 'the board\'s notes go to its session as before');
  assert.match(t.api.typed[0].text, /add the column/);
  assert.equal(t.view.sent.length, 0);
  assert.deepEqual(items(thread(t.document)).map((i) => i.note), ['Which key?'], 'the thread keeps its own');
  t.destroy();
});
