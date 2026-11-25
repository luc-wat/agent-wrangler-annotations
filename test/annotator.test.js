import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotator } from '../public/annotator.js';
import { createStore } from '../public/store.js';
import { makeWindow, renderChat, lendTo, fakeApi, selectText } from './fixture.js';

const CHAT = [
  { user: 'Plan the migration.' },
  { html: '<p>First we add the column.</p><p>Then we backfill it in batches.</p><p>Finally we drop the old table.</p>' },
];

function setup({ storage, session = 's1', lend = false } = {}) {
  const window = makeWindow();
  const { document } = window;
  if (lend) lendTo(document, document.querySelector('.job-mc-host'));
  renderChat(document, CHAT);
  const board = fakeApi({ session });
  storage ||= window.localStorage;
  const ann = createAnnotator({ document, api: board.api, store: createStore({ storage }), storage });
  return { window, document, board, ann, storage };
}

const wait = (window) => new Promise((r) => window.setTimeout(r, 5));

async function annotate(t, text, note) {
  selectText(t.window, text);
  t.document.dispatchEvent(new t.window.MouseEvent('mouseup', { bubbles: true }));
  await wait(t.window);
  const add = t.document.querySelector('.aw-annot-add');
  assert.equal(add.hidden, false, 'the Annotate button shows over a fresh selection');
  add.click();
  const editor = t.document.querySelector('.aw-annot-editor');
  assert.equal(editor.hidden, false);
  editor.querySelector('textarea').value = note;
  editor.querySelector('button[type=submit]').click();
  assert.equal(editor.hidden, true);
}

const items = (document) => [...document.querySelectorAll('.aw-annot-item')].map((li) => ({
  quote: li.querySelector('.aw-annot-quote').textContent,
  note: li.querySelector('.aw-annot-note')?.textContent,
}));

test('highlight, note, see it in the tray; edit and remove it', async () => {
  const t = setup();
  await annotate(t, 'add the column', 'Which type?');
  await annotate(t, 'in batches', 'How big is a batch?');
  await annotate(t, 'drop the old table', 'Keep it a week first.');
  const tray = t.document.querySelector('.aw-annot-tray');
  assert.equal(tray.hidden, false);
  assert.ok(tray.parentNode.id === 'chat-wrap' && tray.nextElementSibling.id === 'chat-composer', 'the tray sits above the composer');
  assert.equal(tray.querySelector('.aw-annot-title').textContent, '3 notes');
  assert.deepEqual(items(t.document).map((i) => i.note), ['Which type?', 'How big is a batch?', 'Keep it a week first.']);

  // Edit the second note.
  t.document.querySelectorAll('.aw-annot-item')[1].querySelector('.aw-annot-actions button').click();
  const box = t.document.querySelector('.aw-annot-item.editing textarea');
  assert.equal(box.value, 'How big is a batch?');
  box.value = 'Batches of 10k rows?';
  [...t.document.querySelectorAll('.aw-annot-item.editing button')].find((b) => b.textContent === 'Save').click();
  assert.equal(items(t.document)[1].note, 'Batches of 10k rows?');

  // Remove the first.
  t.document.querySelector('.aw-annot-item .aw-annot-remove').click();
  assert.deepEqual(items(t.document).map((i) => i.note), ['Batches of 10k rows?', 'Keep it a week first.']);
  t.ann.destroy();
});

test('Send all types one numbered message into the shown session and clears its notes', async () => {
  const t = setup();
  await annotate(t, 'add the column', 'Which type?');
  await annotate(t, 'drop the old table', 'Keep it a week first.');
  t.document.querySelector('.aw-annot-send').click();
  assert.equal(t.board.typed.length, 1);
  assert.deepEqual(t.board.typed[0], {
    session: 's1',
    submit: true,
    text: 'I have notes on 2 passages of this conversation:\n\n1. > add the column\n\n   Which type?\n\n2. > drop the old table\n\n   Keep it a week first.\n\nPlease answer each note in turn and start each answer with its label ("Re note 1:", "Re note 2:" and so on) so I can tell which note it answers.',
  });
  assert.equal(t.document.querySelector('.aw-annot-tray').hidden, true);
  assert.equal(t.storage.getItem('aw-annotations:v1:s1'), null);
  assert.equal(t.board.toasts.at(-1).severity, 'success');
  t.ann.destroy();
});

test('a refused send keeps every note', async () => {
  const t = setup();
  await annotate(t, 'add the column', 'Which type?');
  t.board.refuse = 'gated';
  t.document.querySelector('.aw-annot-send').click();
  assert.equal(items(t.document).length, 1);
  assert.equal(t.board.toasts.at(-1).severity, 'error');
  t.ann.destroy();
});

test('a draft in the message box is never merged into the notes', async () => {
  const t = setup();
  await annotate(t, 'add the column', 'Which type?');
  t.document.getElementById('chat-input').value = 'half-typed thought';
  t.document.querySelector('.aw-annot-send').click();
  assert.equal(t.board.typed.length, 0);
  assert.equal(items(t.document).length, 1);
  t.ann.destroy();
});

test('works the same in the panel Wrangler² borrows (.job-mc-host)', async () => {
  const t = setup({ lend: true, session: 'idea-session' });
  await annotate(t, 'in batches', 'Size?');
  const tray = t.document.querySelector('.aw-annot-tray');
  assert.ok(tray.closest('.job-mc-host'), 'the tray is drawn inside the borrowed panel');
  t.document.querySelector('.aw-annot-send').click();
  assert.equal(t.board.typed[0].session, 'idea-session');
  t.ann.destroy();
});

test('notes follow the session shown and survive a reload', async () => {
  const t = setup();
  await annotate(t, 'add the column', 'Which type?');
  t.board.show({ session: 's2' });
  assert.equal(t.document.querySelector('.aw-annot-tray').hidden, true, 'another session has its own (empty) list');
  t.board.show({ session: 's1' });
  assert.equal(items(t.document).length, 1);
  t.ann.destroy();

  // A reload: a fresh window over the same storage.
  const again = setup({ storage: t.storage });
  assert.deepEqual(items(again.document).map((i) => i.note), ['Which type?']);
  again.ann.destroy();
});

test('no Annotate button for a selection outside the stream or with no session', async () => {
  const t = setup({ session: null });
  selectText(t.window, 'in batches');
  t.document.dispatchEvent(new t.window.MouseEvent('mouseup', { bubbles: true }));
  await wait(t.window);
  assert.equal(t.document.querySelector('.aw-annot-add').hidden, true);
  t.ann.destroy();
});

test('the agent\'s "Re note N:" labels become chips; hover shows the note; they survive a redraw and a reload', async () => {
  const t = setup();
  await annotate(t, 'add the column', 'Which type?');
  await annotate(t, 'drop the old table', 'Keep it a week first.');
  t.document.querySelector('.aw-annot-send').click();
  const sent = t.board.typed[0].text;
  assert.ok(t.storage.getItem('aw-annotations:sent:v1:s1'), 'the sent batch is recorded');

  const withReply = [...CHAT, { user: sent }, { html: '<p><strong>Re note 1:</strong> a bigint.</p><p>Re note 2: agreed, a week.</p>' }];
  renderChat(t.document, withReply);
  await wait(t.window); await wait(t.window);
  const chips = () => [...t.document.querySelectorAll('#chat-stream .aw-annot-reply')];
  assert.deepEqual(chips().map((c) => c.textContent), ['Re note 1', 'Re note 2']);

  chips()[0].dispatchEvent(new t.window.MouseEvent('mouseover', { bubbles: true }));
  const pop = t.document.querySelector('.aw-annot-reply-pop');
  assert.equal(pop.hidden, false);
  assert.equal(pop.parentNode.id, 'chat-stream-wrap', 'the card is drawn inside the panel');
  assert.match(pop.textContent, /add the column/);
  assert.match(pop.textContent, /Which type\?/);
  chips()[0].dispatchEvent(new t.window.MouseEvent('mouseout', { bubbles: true }));
  assert.equal(pop.hidden, true);

  // The chat redraws: the chips come back.
  renderChat(t.document, withReply);
  await wait(t.window); await wait(t.window);
  assert.equal(chips().length, 2);
  t.ann.destroy();
  assert.equal(chips().length, 0, 'destroy takes the chips out');

  // A reload: a fresh window over the same storage.
  const again = setup({ storage: t.storage });
  renderChat(again.document, withReply);
  await wait(again.window); await wait(again.window);
  assert.deepEqual([...again.document.querySelectorAll('.aw-annot-reply')].map((c) => c.dataset.note), ['Which type?', 'Keep it a week first.']);
  again.ann.destroy();
});
