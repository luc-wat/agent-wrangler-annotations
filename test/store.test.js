import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, KEY_PREFIX, SENT_PREFIX, MAX_SENT } from '../public/store.js';

function memoryStorage() {
  const m = new Map();
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

let n = 0;
const ids = () => `id${n++}`;

test('annotations are kept per session id', () => {
  const store = createStore({ storage: memoryStorage(), newId: ids });
  store.add('s1', { quote: 'alpha', note: 'one' });
  store.add('s2', { quote: 'beta', note: 'two' });
  assert.deepEqual(store.list('s1').map((a) => a.quote), ['alpha']);
  assert.deepEqual(store.list('s2').map((a) => a.quote), ['beta']);
  assert.deepEqual(store.list('nope'), []);
});

test('they survive a reload (a new store over the same storage) until cleared', () => {
  const storage = memoryStorage();
  const first = createStore({ storage, newId: ids });
  const a = first.add('s1', { quote: 'alpha', anchor: 'alpha', occurrence: 2, note: 'one' });
  first.add('s1', { quote: 'beta', note: 'two' });
  assert.ok(storage.map.has(`${KEY_PREFIX}s1`));

  const reloaded = createStore({ storage, newId: ids });
  const list = reloaded.list('s1');
  assert.equal(list.length, 2);
  assert.deepEqual({ ...list[0], createdAt: 0 }, { ...a, createdAt: 0 });

  reloaded.clear('s1');
  assert.deepEqual(reloaded.list('s1'), []);
  assert.equal(storage.map.has(`${KEY_PREFIX}s1`), false, 'cleared sessions leave no key behind');
  assert.deepEqual(createStore({ storage }).list('s1'), []);
});

test('update edits a note and remove drops one, both persisted', () => {
  const storage = memoryStorage();
  const store = createStore({ storage, newId: ids });
  const a = store.add('s1', { quote: 'alpha', note: 'old' });
  const b = store.add('s1', { quote: 'beta', note: 'keep' });
  assert.equal(store.update('s1', a.id, 'new'), true);
  assert.equal(store.remove('s1', b.id), true);
  assert.equal(store.update('s1', 'missing', 'x'), false);
  assert.equal(store.remove('s1', 'missing'), false);
  const again = createStore({ storage });
  assert.deepEqual(again.list('s1').map((x) => [x.quote, x.note]), [['alpha', 'new']]);
});

test('listeners hear which session changed', () => {
  const store = createStore({ storage: memoryStorage(), newId: ids });
  const heard = [];
  const off = store.onChange((sid) => heard.push(sid));
  store.add('s1', { quote: 'q' });
  store.clear('s2');
  off();
  store.add('s1', { quote: 'q2' });
  assert.deepEqual(heard, ['s1', 's2']);
});

test('bad input and broken storage never throw', () => {
  const storage = memoryStorage();
  storage.setItem(`${KEY_PREFIX}s1`, '{not json');
  storage.setItem(`${KEY_PREFIX}s2`, JSON.stringify([{ id: 'x', quote: '' }, { id: 'y', quote: 'ok', occurrence: -3 }, 7]));
  const store = createStore({ storage, newId: ids });
  assert.deepEqual(store.list('s1'), []);
  assert.deepEqual(store.list('s2').map((a) => [a.id, a.occurrence, a.anchor]), [['y', 0, 'ok']]);
  assert.equal(store.add('', { quote: 'q' }), null);
  assert.equal(store.add('s3', { quote: '   ' }), null);

  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
  const mem = createStore({ storage: throwing, newId: ids });
  mem.add('s1', { quote: 'still here' });
  assert.deepEqual(mem.list('s1').map((a) => a.quote), ['still here']);
});

test('forget drops the cached copy so another tab’s change is read', () => {
  const storage = memoryStorage();
  const tabA = createStore({ storage, newId: ids });
  const tabB = createStore({ storage, newId: ids });
  assert.deepEqual(tabA.list('s1'), []);
  tabB.add('s1', { quote: 'from B' });
  assert.deepEqual(tabA.list('s1'), []);
  tabA.forget('s1');
  assert.deepEqual(tabA.list('s1').map((a) => a.quote), ['from B']);
});

test('sent batches are recorded per session, oldest first, and survive a reload and a clear', () => {
  const storage = memoryStorage();
  let t = 100;
  const first = createStore({ storage, newId: ids, now: () => t++ });
  first.add('s1', { quote: 'alpha', note: 'one' });
  first.recordSent('s1', { text: 'msg A', items: [{ n: 1, quote: 'alpha', note: 'one' }] });
  first.clear('s1');
  first.recordSent('s1', { text: 'msg B', items: [{ n: 1, quote: 'beta', note: 'two' }, { n: 2, quote: 'gamma', note: '' }] });
  assert.deepEqual(first.sent('s2'), []);
  assert.ok(storage.getItem(SENT_PREFIX + 's1'));
  assert.equal(storage.getItem(KEY_PREFIX + 's1'), null, 'the notes themselves are cleared');

  const again = createStore({ storage, newId: ids });
  assert.deepEqual(again.sent('s1'), [
    { text: 'msg A', sentAt: 101, items: [{ n: 1, quote: 'alpha', note: 'one' }] },
    { text: 'msg B', sentAt: 102, items: [{ n: 1, quote: 'beta', note: 'two' }, { n: 2, quote: 'gamma', note: '' }] },
  ]);
  // A copy: changing it changes nothing stored.
  again.sent('s1')[0].items[0].note = 'changed';
  assert.equal(again.sent('s1')[0].items[0].note, 'one');
});

test('a sent note keeps its anchor and occurrence; a batch saved without them reads as before', () => {
  const storage = memoryStorage();
  storage.setItem(SENT_PREFIX + 'old', JSON.stringify([{ text: 'msg', sentAt: 1, items: [{ n: 1, quote: 'alpha', note: 'one' }] }]));
  const store = createStore({ storage, newId: ids, now: () => 7 });
  assert.deepEqual(store.sent('old')[0].items, [{ n: 1, quote: 'alpha', note: 'one' }]);
  store.recordSent('s1', { text: 'msg', items: [
    { n: 1, quote: 'alpha', note: 'one', anchor: 'alpha  beta', occurrence: 3 },
    { n: 2, quote: 'gamma', note: '', anchor: 'gamma', occurrence: -1 },
    { n: 3, quote: 'delta', note: '', anchor: 5, occurrence: 1 },
  ] });
  assert.deepEqual(createStore({ storage, newId: ids }).sent('s1')[0].items, [
    { n: 1, quote: 'alpha', note: 'one', anchor: 'alpha  beta', occurrence: 3 },
    { n: 2, quote: 'gamma', note: '', anchor: 'gamma' },
    { n: 3, quote: 'delta', note: '' },
  ]);
});

test('only the last MAX_SENT batches are kept; junk in storage is dropped', () => {
  const storage = memoryStorage();
  storage.setItem(SENT_PREFIX + 's1', JSON.stringify([{ text: 'ok', items: [{ n: 1, quote: 'q' }] }, { text: 5 }, null, { text: 'x', items: [{ n: 0, quote: 'q' }] }]));
  const store = createStore({ storage, newId: ids });
  assert.deepEqual(store.sent('s1').map((b) => b.text), ['ok']);
  for (let i = 0; i < MAX_SENT + 3; i += 1) store.recordSent('s1', { text: `m${i}`, items: [{ n: 1, quote: 'q', note: '' }] });
  const kept = store.sent('s1');
  assert.equal(kept.length, MAX_SENT);
  assert.equal(kept.at(-1).text, `m${MAX_SENT + 2}`);
  assert.equal(store.recordSent('s1', { text: 'empty', items: [] }), null);

  storage.setItem(SENT_PREFIX + 's1', 'not json');
  store.forgetSent('s1');
  assert.deepEqual(store.sent('s1'), []);
});
