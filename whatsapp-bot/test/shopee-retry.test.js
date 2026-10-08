import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shopeeQuery } from '../src/shopee-api.js';
const env = { SHOPEE_APP_ID: 'test', SHOPEE_SECRET: 'test' };
test('1. Shopee: indisponibilidade temporária recupera com espera limitada e nova assinatura', async () => {
 let calls = 0, time = 100000; const signatures = [], delays = [];
 const result = await shopeeQuery('{x}', env, async (url, options) => { calls++; signatures.push(options.headers.Authorization); return calls < 3 ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => ({ data: { x: 1 } }) }; }, { now: () => time, sleep: async ms => { delays.push(ms); time += ms; } });
 assert.equal(result.x, 1); assert.equal(calls, 3); assert.deepEqual(delays, [1000,2000]); assert.equal(new Set(signatures).size, 3);
});
test('2. Shopee: timeout encerra após três tentativas sem expor detalhes privados', async () => {
 let calls = 0; const delays = [];
 await assert.rejects(shopeeQuery('{x}', env, async () => { calls++; throw Object.assign(Error('SECRET'), { name: 'TimeoutError' }); }, { sleep: async ms => delays.push(ms) }), error => error.code === 'SHOPEE_TIMEOUT' && !error.message.includes('SECRET'));
 assert.equal(calls, 3); assert.deepEqual(delays,[1000,2000]);
});
test('3. Shopee: credenciais, permissões e consultas inválidas não são repetidas', async () => {
 for (const response of [{ status: 401, ok: false }, { status: 403, ok: false }, { status: 200, ok: true, json: async () => ({ errors: [{ message: 'Invalid signature SECRET' }] }) }, { status: 200, ok: true, json: async () => ({ errors: [{ message: 'Unknown field' }] }) }]) {
  let calls = 0; await assert.rejects(shopeeQuery('{x}', env, async () => { calls++; return response; }, { sleep: async () => assert.fail('No retry') }), error => ['SHOPEE_AUTH','SHOPEE_QUERY'].includes(error.code) && !error.message.includes('SECRET')); assert.equal(calls,1);
 }
 await assert.rejects(shopeeQuery('{x}', {}, async () => assert.fail('No request')), { code: 'SHOPEE_CREDENTIALS' });
});
