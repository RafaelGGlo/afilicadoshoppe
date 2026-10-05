const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ShopeeClient, ShopeeError, sign, buildAuthHeader, demoSearch } = require('../src/shopee');

const mkRes = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json });
const mkClient = (fetchImpl, extra = {}) => new ShopeeClient({ appId: '123', secret: 'sec', endpoint: 'https://x/graphql', fetchImpl, retryDelayMs: 1, minIntervalMs: 0, ...extra });

test('assinatura = SHA256(appId + timestamp + payload + secret)', () => {
  const expected = crypto.createHash('sha256').update('1231577836800{"query":"{a}"}sec').digest('hex');
  assert.equal(sign({ appId: '123', secret: 'sec', timestamp: 1577836800, payload: '{"query":"{a}"}' }), expected);
});
test('cabeçalho Authorization no formato documentado', () => {
  const h = buildAuthHeader({ appId: '123', secret: 'sec', payload: '{}', timestamp: 1577836800 });
  assert.match(h, /^SHA256 Credential=123, Timestamp=1577836800, Signature=[0-9a-f]{64}$/);
  assert.ok(!h.includes('sec,') && !h.includes('Secret'));
});
test('o payload assinado é exatamente o corpo enviado', async () => {
  let seen;
  const c = mkClient(async (url, opts) => { seen = opts; return mkRes(200, { data: { productOfferV2: { nodes: [], pageInfo: {} } } }); });
  await c.searchProducts({ keyword: 'fone' });
  const ts = /Timestamp=(\d+)/.exec(seen.headers.Authorization)[1];
  assert.equal(seen.headers.Authorization.split('Signature=')[1], sign({ appId: '123', secret: 'sec', timestamp: ts, payload: seen.body }));
});
test('searchProducts normaliza campos e preços', async () => {
  const c = mkClient(async () => mkRes(200, { data: { productOfferV2: { nodes: [{ itemId: 9, productName: ' Tênis ', priceMin: '99.9', priceMax: '149.9', imageUrl: 'https://i/x.jpg', productLink: 'https://shopee.com.br/p', offerLink: 'https://s.shopee.com.br/o', shopId: 5 }], pageInfo: { hasNextPage: true } } } }));
  const r = await c.searchProducts({ keyword: 'tenis', limit: 1 });
  assert.deepEqual(r.nodes[0], { itemId: '9', shopId: '5', name: 'Tênis', priceMin: 99.9, priceMax: 149.9, imageUrl: 'https://i/x.jpg', productLink: 'https://shopee.com.br/p', offerLink: 'https://s.shopee.com.br/o' });
  assert.equal(r.hasNextPage, true); // página cheia (1 de 1) => provavelmente há mais
  const c2 = mkClient(async () => mkRes(200, { data: { productOfferV2: { nodes: [] } } }));
  assert.equal((await c2.searchProducts({ keyword: 'x', limit: 20 })).hasNextPage, false);
});
test('a consulta não pede campos não confirmados (pageInfo)', async () => {
  let q;
  const c = mkClient(async (u, o) => { q = JSON.parse(o.body).query; return mkRes(200, { data: { productOfferV2: { nodes: [] } } }); });
  await c.searchProducts({ keyword: 'x' });
  assert.ok(!q.includes('pageInfo'));
  assert.match(q, /productOfferV2\(page:1,limit:20,sortType:5,keyword:"x"\)/);
});
test('palavra-chave com aspas não quebra a query (escapada)', async () => {
  let body;
  const c = mkClient(async (u, o) => { body = JSON.parse(o.body); return mkRes(200, { data: { productOfferV2: { nodes: [], pageInfo: {} } } }); });
  await c.searchProducts({ keyword: 'a"b\\c' });
  assert.ok(body.query.includes('keyword:"a\\"b\\\\c"'));
});
test('erro 10020 vira mensagem amigável e NÃO tenta de novo', async () => {
  let n = 0;
  const c = mkClient(async () => { n++; return mkRes(200, { errors: [{ message: 'Invalid Signature', extensions: { code: 10020 } }] }); });
  await assert.rejects(() => c.searchProducts({ keyword: 'x' }), e => e instanceof ShopeeError && e.code === 10020 && /relógio/.test(e.message));
  assert.equal(n, 1);
});
test('limite 10030 / HTTP 429 tenta de novo e depois funciona', async () => {
  let n = 0;
  const c = mkClient(async () => (++n < 3 ? mkRes(429, {}) : mkRes(200, { data: { productOfferV2: { nodes: [], pageInfo: {} } } })));
  await c.searchProducts({ keyword: 'x' });
  assert.equal(n, 3);
});
test('429 contínuo desiste após as tentativas e informa o limite', async () => {
  let n = 0;
  const c = mkClient(async () => { n++; return mkRes(429, {}); });
  await assert.rejects(() => c.searchProducts({ keyword: 'x' }), e => e.code === 10030);
  assert.equal(n, 3); // 1 + 2 retentativas
});
test('HTTP 500 é tentado de novo; resposta não-JSON gera erro claro', async () => {
  let n = 0;
  const c = mkClient(async () => { n++; return mkRes(500, {}); });
  await assert.rejects(() => c.searchProducts({ keyword: 'x' }), /servidor da Shopee/);
  assert.equal(n, 3);
  const c2 = mkClient(async () => ({ status: 200, ok: true, json: async () => { throw new Error('x'); } }));
  await assert.rejects(() => c2.searchProducts({ keyword: 'x' }), /Resposta inválida/);
});
test('timeout é respeitado', async () => {
  const c = mkClient((u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' })))), { timeoutMs: 20, retries: 0 });
  await assert.rejects(() => c.searchProducts({ keyword: 'x' }), /timeout/);
});
test('generateShortLink devolve o link e usa no máx. 5 subIds', async () => {
  let q;
  const c = mkClient(async (u, o) => { q = JSON.parse(o.body).query; return mkRes(200, { data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/abc' } } }); });
  assert.equal(await c.generateShortLink('https://shopee.com.br/p', ['1', '2', '3', '4', '5', '6']), 'https://s.shopee.com.br/abc');
  assert.equal((q.match(/"[1-6]"/g) || []).length, 5);
});
test('generateShortLink sem link na resposta é erro', async () => {
  const c = mkClient(async () => mkRes(200, { data: { generateShortLink: null } }));
  await assert.rejects(() => c.generateShortLink('https://shopee.com.br/p'), /não devolveu/);
});
test('modo demo: tudo marcado como [DEMO], sem imagem nem link', () => {
  const r = demoSearch({ keyword: 'fone', page: 1, limit: 20 });
  assert.ok(r.nodes.length > 0);
  for (const n of r.nodes) { assert.match(n.name, /^\[DEMO\]/); assert.match(n.itemId, /^DEMO-/); assert.equal(n.imageUrl, null); assert.equal(n.offerLink, null); }
});
