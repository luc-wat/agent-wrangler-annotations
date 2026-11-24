import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, KEY_PREFIX } from '../public/store.js';

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
