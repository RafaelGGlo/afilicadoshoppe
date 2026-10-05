const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const dbm = require('../src/db');
const { createApp } = require('../src/server');

async function boot({ password = '', client = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-'));
  const cfg = { appId: '', secret: '', endpoint: '', port: 0, host: '127.0.0.1', panelPassword: password, sessionSecret: 'segredo-de-teste', dataDir: dir, imagesDir: path.join(dir, 'images'), dbFile: ':memory:' };
  const { app, db } = createApp({ cfg, db: dbm.open(':memory:'), client });
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, { method = 'GET', body, headers = {}, raw, cookie } = {}) => fetch(base + p, {
    method,
    headers: { 'X-Requested-With': 'painel', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  return { call, db, close: () => server.close() };
}

test('sem senha configurada: painel abre direto, modo demo ativo e fluxo completo funciona', async () => {
  const s = await boot();
  try {
    assert.equal((await (await s.call('/api/status')).json()).demoMode, true);
    const r = await (await s.call('/api/search', { method: 'POST', body: { keyword: 'mouse' } })).json();
    assert.equal(r.mode, 'demo'); assert.ok(r.created > 0);
    const { offers } = await (await s.call('/api/offers')).json();
    assert.ok(offers.every(o => o.source === 'demo' && o.name.startsWith('[DEMO]')));
    assert.ok(!JSON.stringify(offers).includes('image_file'));            // sem caminhos internos
    const fin = await (await s.call(`/api/offers/${offers[0].id}/finalize`, { method: 'POST' })).json();
    assert.equal(fin.refreshed, false);
    const hist = await (await s.call('/api/history')).json();
    assert.ok(hist.history.some(h => h.kind === 'consulta'));
  } finally { s.close(); }
});

test('CSRF: POST sem o cabeçalho do painel é recusado', async () => {
  const s = await boot();
  try {
    const res = await s.call('/api/search', { method: 'POST', body: {}, headers: { 'X-Requested-With': '' } });
    assert.equal(res.status, 403);
    assert.equal((await s.call('/api/manual', { method: 'POST', body: {}, headers: { 'X-Requested-With': '' } })).status, 403);
  } finally { s.close(); }
});

test('com senha: API e imagens exigem login; senha errada falha; limite de tentativas; cookie HttpOnly/SameSite', async () => {
  const s = await boot({ password: 'abc123' });
  try {
    assert.equal((await s.call('/api/offers')).status, 401);
    assert.equal((await s.call('/api/manual', { method: 'POST', body: {} })).status, 401);
    assert.equal((await s.call('/api/manual/1', { method: 'PUT', body: {} })).status, 401);
    assert.equal((await s.call('/api/offers/1/duplicate', { method: 'POST' })).status, 401);
    assert.equal((await s.call('/imagens/qualquer.jpg')).status, 401);
    assert.equal((await s.call('/api/login', { method: 'POST', body: { password: 'errada' } })).status, 401);
    const ok = await s.call('/api/login', { method: 'POST', body: { password: 'abc123' } });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];
    assert.equal((await s.call('/api/offers', { cookie })).status, 200);
    assert.equal((await s.call('/api/offers', { cookie: cookie.slice(0, -3) + 'xxx' })).status, 401); // token adulterado
  } finally { s.close(); }
});

test('bloqueio após muitas senhas erradas', async () => {
  const s = await boot({ password: 'abc123' });
  try {
    let last;
    for (let i = 0; i < 6; i++) last = await s.call('/api/login', { method: 'POST', body: { password: 'x' + i } });
    assert.equal(last.status, 429);
    assert.equal((await s.call('/api/login', { method: 'POST', body: { password: 'abc123' } })).status, 429);
  } finally { s.close(); }
});

test('configurações: valida, limita valores e exige {link} no modelo', async () => {
  const s = await boot();
  try {
    const bad = await s.call('/api/settings', { method: 'PUT', body: { template: 'sem o link aqui' } });
    assert.equal(bad.status, 400);
    const r = await (await s.call('/api/settings', { method: 'PUT', body: { keywords: 'a, b\nc', maxPerRun: 9999, autoEveryMinutes: 1, pagesPerQuery: 99, priceMin: '', lastAutoRunAt: 'hack' } })).json();
    assert.deepEqual(r.keywords, ['a', 'b', 'c']);
    assert.equal(r.maxPerRun, 50); assert.equal(r.autoEveryMinutes, 15); assert.equal(r.pagesPerQuery, 5);
    assert.equal(r.lastAutoRunAt, null);                                   // não editável pelo painel
  } finally { s.close(); }
});

test('upload manual de imagem: aceita imagem real e recusa arquivo falso; imagem exige login para ser vista', async () => {
  const s = await boot();
  try {
    await s.call('/api/search', { method: 'POST', body: { keyword: 'x' } });
    const { offers } = await (await s.call('/api/offers')).json();
    const id = offers[0].id;
    const fake = await s.call(`/api/offers/${id}/image`, { method: 'POST', raw: Buffer.from('<?php system($_GET[0]); ?>'), headers: { 'Content-Type': 'image/jpeg' } });
    assert.equal(fake.status, 400);
    const png = await sharp({ create: { width: 700, height: 700, channels: 3, background: '#00f' } }).png().toBuffer();
    const good = await s.call(`/api/offers/${id}/image`, { method: 'POST', raw: png, headers: { 'Content-Type': 'image/png' } });
    assert.equal(good.status, 200);
    const o = await good.json();
    assert.match(o.imageUrl, /^\/imagens\/[0-9a-f]+\.jpg$/);
    assert.equal(o.status, 'revisao');                                     // demo continua em revisão mesmo com imagem
    const img = await s.call(o.imageUrl);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
  } finally { s.close(); }
});

test('marcar como publicada só acontece por ação explícita (PATCH), nunca por compartilhar', async () => {
  const s = await boot();
  try {
    await s.call('/api/search', { method: 'POST', body: { keyword: 'y' } });
    const { offers } = await (await s.call('/api/offers')).json();
    const id = offers[0].id;
    await s.call(`/api/offers/${id}/finalize`, { method: 'POST' });
    assert.notEqual((await (await s.call(`/api/offers/${id}`)).json()).status, 'publicada');
    const p = await (await s.call(`/api/offers/${id}`, { method: 'PATCH', body: { status: 'publicada' } })).json();
    assert.equal(p.status, 'publicada');
    assert.equal((await s.call(`/api/offers/${id}`, { method: 'PATCH', body: { status: 'enviada' } })).status, 400);
    assert.equal((await s.call('/api/offers/9999')).status, 404);
  } finally { s.close(); }
});

test('cadastro manual funciona sem credenciais e sem cliente de API', async () => {
  const s = await boot({ client: null });
  try {
    const imageBase64 = (await sharp({ create: { width: 600, height: 600, channels: 3, background: '#fff' } }).png().toBuffer()).toString('base64');
    const response = await s.call('/api/manual', { method: 'POST', body: { name: 'Oferta real', affiliateLink: 'https://s.shopee.com.br/real?subid=manual', priceMin: '25,90', category: 'Outros', imageBase64 } });
    assert.equal(response.status, 200);
    const offer = await response.json();
    assert.equal(offer.source, 'manual'); assert.equal(offer.status, 'preparada');
    const finalized = await (await s.call(`/api/offers/${offer.id}/finalize`, { method: 'POST' })).json();
    assert.match(finalized.note, /Oferta manual/); assert.equal(finalized.offer.caption, offer.caption);
  } finally { s.close(); }
});
