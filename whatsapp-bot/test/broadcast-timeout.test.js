import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SentStore } from '../src/store.js';
import { createBroadcaster } from '../src/broadcast.js';

function fixture(t, sendMessage) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-timeout-'));
 t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
 let time = 0, nextId = 1;
 const timers = new Map(), warnings = [];
 const store = new SentStore(path.join(dir, 'history.json'), 86400000, () => time);
 const send = createBroadcaster({ store, groups: ['A', 'B'], minMs: 1, maxMs: 1,
  sendTimeoutMs: 45000, now: () => time, sleep: async ms => { time += ms; },
  getSocket: () => ({ sendMessage }), logger: { info() {}, warn(data) { warnings.push(data); } },
  setTimer: (callback, delay) => { const id = nextId++; timers.set(id, { callback, at: time + delay }); return id; },
  clearTimer: id => timers.delete(id),
 });
 return { send, store, timers, warnings, advance(ms) {
  time += ms;
  for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); }
 } };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deal = { id: 'product' };

test('1. a confirmed send marks each group as sent and clears its deadline timer', async t => {
 const calls = [];
 const f = fixture(t, async group => { calls.push(group); });
 await f.send(deal, Buffer.from('image'), 'caption');
 assert.deepEqual(calls, ['A', 'B']);
 assert.equal(f.store.data[f.store.key(deal.id, 'A')].status, 'sent');
 assert.equal(f.store.data[f.store.key(deal.id, 'B')].status, 'sent');
 assert.equal(f.timers.size, 0);
 assert.equal(f.warnings.length, 0);
});

test('2. an unresponsive send stops waiting at 45 seconds and preserves reservation even after a late result', async t => {
 let finishLate;
 const calls = [];
 const f = fixture(t, group => { calls.push(group); return group === 'A' ? new Promise(resolve => { finishLate = resolve; }) : Promise.resolve(); });
 const running = f.send(deal, Buffer.from('image'), 'caption');
 await flush();
 f.advance(44999);
 await flush();
 assert.deepEqual(calls, ['A']);
 f.advance(1);
 await running;
 assert.deepEqual(calls, ['A', 'B']);
 assert.equal(f.warnings[0].reason, 'SEND_TIMEOUT');
 assert.equal(f.store.data[f.store.key(deal.id, 'A')].status, 'pending');
 finishLate();
 await flush();
 assert.equal(f.store.data[f.store.key(deal.id, 'A')].status, 'pending');
 await f.send(deal, Buffer.from('image'), 'caption');
 assert.deepEqual(calls, ['A', 'B']);
 assert.equal(f.timers.size, 0);
});

test('3. an immediate send failure does not block other groups or subsequent offers', async t => {
 const calls = [];
 const f = fixture(t, async (group, payload) => { calls.push([group, payload.caption]); if (group === 'A' && payload.caption === 'first') throw Error('Connection failed'); });
 await f.send(deal, Buffer.from('image'), 'first');
 await f.send({ id: 'next-product' }, Buffer.from('image'), 'second');
 assert.deepEqual(calls, [['A', 'first'], ['B', 'first'], ['A', 'second'], ['B', 'second']]);
 assert.equal(f.store.data[f.store.key(deal.id, 'A')].status, 'pending');
 assert.equal(f.store.data[f.store.key('next-product', 'A')].status, 'sent');
 assert.equal(f.timers.size, 0);
});
