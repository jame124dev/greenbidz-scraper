/**
 * Offline unit tests for the content fingerprint.
 * Run: node --test utils/contentHash.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from './contentHash.js';

test('same content → same hash (stable)', () => {
  const a = fingerprint({ title: 'CNC Lathe', price: 5000, description: 'Good condition' });
  const b = fingerprint({ title: 'CNC Lathe', price: 5000, description: 'Good condition' });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('changed price → different hash', () => {
  const a = fingerprint({ title: 'CNC Lathe', price: 5000, description: 'x' });
  const b = fingerprint({ title: 'CNC Lathe', price: 4500, description: 'x' });
  assert.notEqual(a, b);
});

test('changed title or description → different hash', () => {
  const base = fingerprint({ title: 'A', price: 1, description: 'd' });
  assert.notEqual(base, fingerprint({ title: 'B', price: 1, description: 'd' }));
  assert.notEqual(base, fingerprint({ title: 'A', price: 1, description: 'd2' }));
});

test('cosmetic noise (whitespace/case) does NOT change the hash', () => {
  const a = fingerprint({ title: 'CNC Lathe', price: 5000, description: 'Good   condition' });
  const b = fingerprint({ title: '  cnc   lathe ', price: 5000, description: ' good condition ' });
  assert.equal(a, b);
});

test('price formats normalize equal: 5000 == "5000.00" == "$5,000"', () => {
  const n = fingerprint({ title: 't', price: 5000, description: 'd' });
  assert.equal(n, fingerprint({ title: 't', price: '5000.00', description: 'd' }));
  assert.equal(n, fingerprint({ title: 't', price: '$5,000', description: 'd' }));
});

test('missing fields are handled (no throw, stable)', () => {
  const a = fingerprint({});
  const b = fingerprint({ title: null, price: undefined, description: '' });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});
