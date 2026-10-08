import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SendPacing } from '../src/send-pacing.js';
import { SentStore } from '../src/store.js';
import { createBroadcaster } from '../src/broadcast.js';

const minMs = 10 * 60000, maxMs = 15 * 60000;
function fixture(t, chooseInterval = minimum => minimum) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-pacing-'));
 t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
 let time = 1000;
 const now = () => time;
 const file = path.join(dir, 'schedule.json');
 const pacing = new SendPacing(file, { minMs, maxMs, now, chooseInterval });
 const store = new SentStore(path.join(dir, 'sent.json'), 86400000, now);
 const calls = [];
 const send = createBroadcaster({ store, groups: ['A', 'B'], minMs: 1, maxMs: 1, pacing, now,
  sleep: async ms => { time += ms; }, getSocket: () => ({ sendMessage: async (group, payload) => { calls.push([group, payload.caption]); } }),
  logger: { info() {}, warn() {} },
 });
 return { file, now, pacing, store, calls, send, advance: ms => { time += ms; } };
}

test('1. the first message waits for the selected interval and never sends before 10 minutes', async t => {
 for (const selected of [minMs, maxMs]) {
  const f = fixture(t, () => selected);
  await f.send({ id: 'first' }, Buffer.from('image'), 'first');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.store.data, {});
  f.advance(selected - 1);
  await f.send({ id: 'first' }, Buffer.from('image'), 'first');
  assert.equal(f.calls.length, 0);
  f.advance(1);
  await f.send({ id: 'first' }, Buffer.from('image'), 'first');
  assert.deepEqual(f.calls, [['A', 'first']]);
  assert.equal(f.pacing.nextAllowedAt - f.now(), selected);
 }
});

test('2. early offers are held, and an empty search after the deadline does not restart the waiting interval', async t => {
 const f = fixture(t);
 f.advance(minMs);
 await f.send({ id: 'first' }, Buffer.from('image'), 'first');
 f.advance(5 * 60000);
 await f.send({ id: 'second' }, Buffer.from('image'), 'second');
 assert.equal(f.calls.length, 1);
 f.advance(5 * 60000);
 const due = f.pacing.nextAllowedAt;
 assert.equal(f.pacing.canSend(), true);
 // No eligible offer means no send attempt and no claim of a new interval.
 f.advance(3 * 60000);
 assert.equal(f.pacing.nextAllowedAt, due);
 assert.equal(f.pacing.canSend(), true);
 await f.send({ id: 'second' }, Buffer.from('image'), 'fresh-second');
 assert.deepEqual(f.calls, [['A', 'first'], ['A', 'fresh-second']]);
});

test('3. restarting preserves the next allowed send time and another group cannot bypass the interval', async t => {
 const f = fixture(t);
 f.advance(minMs);
 await f.send({ id: 'first' }, Buffer.from('image'), 'first');
 const reopened = new SendPacing(f.file, { minMs, maxMs, now: f.now, chooseInterval: minimum => minimum });
 assert.equal(reopened.nextAllowedAt, f.pacing.nextAllowedAt);
 assert.equal(reopened.canSend(), false);
 await f.send({ id: 'first' }, Buffer.from('image'), 'first');
 assert.equal(f.calls.length, 1);
 f.advance(minMs);
 assert.equal(reopened.canSend(), true);
 await f.send({ id: 'first' }, Buffer.from('image'), 'first');
 assert.deepEqual(f.calls, [['A', 'first'], ['B', 'first']]);
});
