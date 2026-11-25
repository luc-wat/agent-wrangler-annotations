import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLabels, batchForReplies, labelReplies } from '../public/replies.js';
import { makeWindow, renderChat } from './fixture.js';

test('labels are found with N, the colon left outside the chip', () => {
  const text = 'Re note 1: yes. Then **Re note 12 :** no.\nre note 3: lower case. Re note 0: Pre note 4: Re note x: Re note 5 without colon';
  assert.deepEqual(findLabels(text), [
    { start: 0, end: 9, n: 1 },
    { start: 23, end: 33, n: 12 },
    { start: 42, end: 51, n: 3 },
  ]);
  assert.deepEqual(findLabels(''), []);
  assert.deepEqual(findLabels(null), []);
});

const A = { text: 'batch A message', items: [] };
const B = { text: 'batch B message', items: [] };

test('a reply answers the nearest sent batch above it', () => {
  const entries = [
    { kind: 'user', text: 'batch  A\n message' },
    { kind: 'reply' },
    { kind: 'user', text: 'something else' },
    { kind: 'reply' },
    { kind: 'user', text: 'batch B message' },
    { kind: 'reply' },
  ];
  assert.deepEqual(batchForReplies(entries, [A, B]), [0, 0, 1]);
});

test('a reused number maps to the batch before a later batch message, else the newest', () => {
  // The batch message for the first reply is out of the loaded window; B's
  // message comes after it, so it answers the batch sent before B.
  assert.deepEqual(batchForReplies([{ kind: 'reply' }, { kind: 'user', text: 'batch B message' }, { kind: 'reply' }], [A, B]), [0, 1]);
  assert.deepEqual(batchForReplies([{ kind: 'reply' }], [A, B]), [1]);
  assert.deepEqual(batchForReplies([{ kind: 'reply' }], []), [-1]);
  // Two identical messages: the later batch wins.
  assert.deepEqual(batchForReplies([{ kind: 'user', text: 'same' }, { kind: 'reply' }], [{ text: 'same' }, { text: 'same' }]), [1]);
});

test('labels in replies become chips carrying the note; idempotent; unknown numbers and user text left alone', () => {
  const window = makeWindow();
  const { document } = window;
  const batches = [
    { text: 'first batch', items: [{ n: 1, quote: 'old excerpt', note: 'old note' }] },
    { text: 'second batch', items: [{ n: 1, quote: 'add the column', note: 'Which type?' }, { n: 2, quote: 'drop it', note: '' }] },
  ];
  const stream = renderChat(document, [
    { user: 'first batch' },
    { html: '<p>Re note 1: the old answer.</p>' },
    { user: 'second batch' },
    { html: '<p><strong>Re note 1:</strong> an integer.</p><p>Re note 2: after a week. Re note 3: none.</p><pre><code>Re note 1: code</code></pre>' },
    { user: 'Re note 1: typed by me' },
  ]);
  const chips = labelReplies(stream, batches);
  assert.equal(chips.length, 3);
  const [old, one, two] = [...stream.querySelectorAll('.aw-annot-reply')];
  assert.equal(old.dataset.note, 'old note', 'the first reply answers the first batch');
  assert.equal(one.textContent, 'Re note 1');
  assert.equal(one.parentElement.tagName, 'STRONG');
  assert.equal(one.dataset.quote, 'add the column');
  assert.equal(one.dataset.note, 'Which type?');
  assert.equal(two.dataset.n, '2');
  assert.equal(stream.children[3].textContent, 'Re note 1: an integer.Re note 2: after a week. Re note 3: none.Re note 1: code', 'the text is unchanged');

  const before = stream.innerHTML;
  assert.equal(labelReplies(stream, batches).length, 3);
  assert.equal(stream.innerHTML, before, 'a second pass changes nothing');

  labelReplies(stream, []);
  assert.equal(stream.querySelectorAll('.aw-annot-reply').length, 0, 'with no record the chips go');
  assert.equal(stream.children[3].textContent, 'Re note 1: an integer.Re note 2: after a week. Re note 3: none.Re note 1: code');
});
