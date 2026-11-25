import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMessage, tidyQuote, sentItems, MAX_QUOTE_CHARS } from '../public/compose.js';

test('three annotations become one numbered message, each excerpt quoted with its note beneath', () => {
  const text = composeMessage([
    { quote: 'Use a mutex around the cache.', note: 'Why not a read-write lock?' },
    { quote: 'Step one: migrate.\n\nStep two: backfill.', note: 'Backfill first,\nthen migrate.' },
    { quote: 'Tests pass.', note: '' },
  ]);
  assert.equal(text, [
    'I have notes on 3 passages of this conversation:',
    '',
    '1. > Use a mutex around the cache.',
    '',
    '   Why not a read-write lock?',
    '',
    '2. > Step one: migrate.',
    '   > Step two: backfill.',
    '',
    '   Backfill first,',
    '   then migrate.',
    '',
    '3. > Tests pass.',
    '',
    'Please answer each note in turn and start each answer with its label ("Re note 1:", "Re note 2:" and so on) so I can tell which note it answers.',
  ].join('\n'));
});

test('a single annotation says so', () => {
  assert.equal(composeMessage([{ quote: 'x', note: 'y' }]), 'I have a note on one passage of this conversation:\n\n1. > x\n\n   y\n\nPlease start your answer with "Re note 1:" so I can tell which note it answers.');
});

test('numbers pad their continuation lines to line up past two digits', () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ quote: `q${i}\nmore`, note: `n${i}` }));
  const text = composeMessage(list);
  assert.match(text, /\n10\. > q9\n    > more\n\n    n9\n\nPlease answer each note/);
});

test('nothing to send gives an empty message; blank excerpts are skipped', () => {
  assert.equal(composeMessage([]), '');
  assert.equal(composeMessage(null), '');
  assert.equal(composeMessage([{ quote: '  \n ', note: 'lost' }]), '');
});

test('excerpts are tidied: blank lines and runs of spaces go, long ones are cut', () => {
  assert.equal(tidyQuote('  a   b \r\n\r\n\tc  '), 'a b\nc');
  const long = 'w'.repeat(MAX_QUOTE_CHARS + 50);
  const cut = tidyQuote(long);
  assert.equal(cut.length, MAX_QUOTE_CHARS + 1);
  assert.ok(cut.endsWith('…'));
});

test('the record of a sent batch numbers notes as the message does, skipping blank excerpts', () => {
  assert.deepEqual(sentItems([
    { quote: '  a   b ', note: ' why? ' },
    { quote: ' \n ', note: 'dropped' },
    { quote: 'c', note: undefined },
  ]), [
    { n: 1, quote: 'a b', note: 'why?' },
    { n: 2, quote: 'c', note: '' },
  ]);
});
