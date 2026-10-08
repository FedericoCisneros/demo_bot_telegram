import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it, mock } from 'node:test';
import { RelayStore } from '../src/relay-store.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'relay-store-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const alice = { customerChatId: 2001, customerName: 'Alice' };
const bob = { customerChatId: 2002, customerName: 'Bob' };

describe('RelayStore', () => {
  it('maps owner-chat message IDs to customers', () => {
    const store = new RelayStore();
    store.link(10, alice);
    store.link(11, bob);
    assert.deepEqual(store.lookup(10), alice);
    assert.deepEqual(store.lookup(11), bob);
    assert.equal(store.lookup(12), undefined);
  });

  it('survives a restart when backed by a file', () => {
    const filePath = path.join(dir, 'nested', 'map.json');
    new RelayStore({ filePath }).link(42, alice);

    const reopened = new RelayStore({ filePath });
    assert.deepEqual(reopened.lookup(42), alice);
  });

  it('forgets the oldest links past the limit', () => {
    const filePath = path.join(dir, 'capped.json');
    const store = new RelayStore({ filePath, maxEntries: 2 });
    store.link(1, alice);
    store.link(2, bob);
    store.link(3, alice);

    assert.equal(store.size, 2);
    assert.equal(store.lookup(1), undefined);
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).entries.length, 2);
  });

  it('starts empty instead of crashing on a corrupt file', () => {
    const filePath = path.join(dir, 'corrupt.json');
    writeFileSync(filePath, '{ not json');
    const warn = mock.method(console, 'warn', () => {});

    const store = new RelayStore({ filePath });
    assert.equal(store.size, 0);
    assert.equal(warn.mock.callCount(), 1);
    warn.mock.restore();
  });
});
