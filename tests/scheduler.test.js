const test = require('node:test');
const assert = require('node:assert/strict');
const dbm = require('../src/db');
const { createRunner } = require('../src/scheduler');

test('não dispara se automático está desligado; dispara quando venceu o intervalo; respeita o mínimo de 15 min', async () => {
  const db = dbm.open(':memory:');
  let calls = 0;
  const runner = createRunner({ db, runSearch: async () => { calls++; return {}; } });
  assert.equal(runner.tick(), false);
  dbm.saveSettings(db, { autoEnabled: true, autoEveryMinutes: 1 });
  assert.equal(runner.tick(), true);              // nunca rodou
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls, 1);
  assert.equal(runner.tick(), false);             // acabou de rodar (mínimo 15 min)
  assert.equal(runner.tick(Date.now() + 16 * 60000), true);
});

test('evita tarefas duplicadas: segunda execução enquanto a primeira roda é recusada', async () => {
  const db = dbm.open(':memory:');
  let release; const gate = new Promise(r => { release = r; });
  let calls = 0;
  const runner = createRunner({ db, runSearch: async () => { calls++; await gate; return { ok: true }; } });
  const p1 = runner.run('manual');
  assert.deepEqual(await runner.run('manual'), { busy: true });
  dbm.saveSettings(db, { autoEnabled: true });
  assert.equal(runner.tick(), false);
  release(); await p1;
  assert.equal(calls, 1);
  assert.equal(runner.isRunning(), false);
});

test('falha na consulta automática libera a trava e não derruba o processo', async () => {
  const db = dbm.open(':memory:');
  const runner = createRunner({ db, runSearch: async () => { throw new Error('boom'); } });
  dbm.saveSettings(db, { autoEnabled: true });
  assert.equal(runner.tick(), true);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(runner.isRunning(), false);
  assert.ok(db.prepare("SELECT 1 FROM history WHERE kind='erro'").get());
});
