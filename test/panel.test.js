import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findChatPanel, panelHome, chatShown, selectionTarget, locate, flatText } from '../public/panel.js';
import { makeWindow, renderChat, lendTo, selectText } from './fixture.js';

const CHAT = [
  { user: 'Please refactor the cache.' },
  { html: '<p>I will add a <strong>mutex</strong> around the cache.</p><p>Then the cache is safe.</p>' },
  { html: '<ul><li>Step one: migrate.</li><li>Step two: backfill the cache.</li></ul>' },
];

test('finds core’s Chat panel on the board', () => {
  const { document } = makeWindow();
  const p = findChatPanel(document);
  assert.ok(p);
  assert.equal(p.stream.id, 'chat-stream');
  assert.equal(p.streamWrap.id, 'chat-stream-wrap');
  assert.equal(p.composer.id, 'chat-composer');
  assert.equal(p.input.id, 'chat-input');
  assert.equal(panelHome(p), 'board');
  assert.equal(chatShown(p), true);
});

test('finds the same panel once Wrangler² borrows it into .job-mc-host', () => {
  const { document } = makeWindow();
  const before = findChatPanel(document);
  lendTo(document, document.querySelector('.job-mc-host'));
  const p = findChatPanel(document);
  assert.equal(p.stream, before.stream, 'the panel is moved, not copied');
  assert.equal(panelHome(p), 'wrangler');
  assert.ok(p.wrap.closest('.job-mc-host'));
});

test('no panel, or Chat hidden behind the Terminal, is reported', () => {
  const { document } = makeWindow();
  const p = findChatPanel(document);
  p.wrap.hidden = true;
  assert.equal(chatShown(p), false);
  p.wrap.hidden = false;
  document.getElementById('sidebar').classList.add('collapsed');
  assert.equal(chatShown(p), false);
  document.getElementById('chat-wrap').remove();
  assert.equal(findChatPanel(document), null);
});

test('a selection in the stream becomes a target that is found again after a re-render', () => {
  const window = makeWindow();
  const { document } = window;
  renderChat(document, CHAT);
  const stream = document.getElementById('chat-stream');
  selectText(window, 'the cache', 1); // "Then the cache is safe."
  const t = selectionTarget(window.getSelection(), stream);
  assert.equal(t.quote, 'the cache');
  assert.equal(t.anchor, 'the cache');
  assert.equal(t.occurrence, 1);

  // The chat view re-renders its nodes (a remount): the excerpt is found by text.
  renderChat(document, CHAT);
  const r = locate(stream, t.anchor, t.occurrence);
  assert.equal(r.toString(), 'the cache');
  const flat = flatText(stream);
  const before = document.createRange();
  before.setStart(stream, 0);
  before.setEnd(r.startContainer, r.startOffset);
  assert.equal(flat.indexOf('the cache', flat.indexOf('the cache') + 1), before.toString().length);
});

test('a selection across elements keeps its words for the message', () => {
  const window = makeWindow();
  const { document } = window;
  renderChat(document, CHAT);
  const stream = document.getElementById('chat-stream');
  const a = selectText(window, 'mutex');
  const b = selectText(window, 'around the');
  const r = document.createRange();
  r.setStart(a.startContainer, a.startOffset);
  r.setEnd(b.endContainer, b.endOffset);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(r);
  const t = selectionTarget(window.getSelection(), stream);
  assert.equal(t.anchor, 'mutex around the');
  assert.equal(locate(stream, t.anchor, t.occurrence).toString(), 'mutex around the');
});

test('selections outside the stream, or empty, are not targets', () => {
  const window = makeWindow();
  const { document } = window;
  renderChat(document, CHAT);
  const stream = document.getElementById('chat-stream');
  const input = document.getElementById('chat-input');
  input.value = 'draft';
  const r = document.createRange();
  r.selectNodeContents(document.getElementById('chat-send'));
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(r);
  assert.equal(selectionTarget(window.getSelection(), stream), null);
  window.getSelection().removeAllRanges();
  assert.equal(selectionTarget(window.getSelection(), stream), null);
});

test('an excerpt no longer in the loaded window is not located', () => {
  const window = makeWindow();
  renderChat(window.document, CHAT);
  assert.equal(locate(window.document.getElementById('chat-stream'), 'never said', 0), null);
});
