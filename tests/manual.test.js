const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const dbm = require('../src/db');
const { createApp } = require('../src/server');
const { validateLink } = require('../src/manual');
const { buildCaption } = require('../src/message');
const { checkUrl, isPrivateIp, processBuffer } = require('../src/images');

const link = 'https://s.shopee.com.br/abc?utm_source=WhatsApp&sub_id=A%2fb&x=1&x=2#produto';
const fields = { name: 'Produto real', affiliateLink: link, priceMin: '80,00', previousPrice: '100', sameVariant: true, category: 'Casa', coupon: 'CASA10', couponConditions: 'Compra mínima de R$ 100', observations: 'Variante azul' };
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#123456' } }).png().toBuffer();

test('manual: cadastro, persistência, edição, duplicação, revisão e publicação sem API', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-offers-'));
  const file = path.join(dir, 'offers.db');
  const cfg = { imagesDir: path.join(dir, 'images'), dbFile: file, panelPassword: '', sessionSecret: 'test' };
  // Mesmo com cliente configurado, uma oferta manual nunca consulta a API.
  const client = { searchProducts() { throw new Error('API não deveria ser usada'); } };
  const { app, db } = createApp({ cfg, client });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const call = async (url, method = 'GET', body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'X-Requested-With': 'painel', 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  let id;
  try {
    const imageBase64 = (await sharp(require('node:crypto').randomBytes(800 * 600 * 3), { raw: { width: 800, height: 600, channels: 3 } }).png().toBuffer()).toString('base64');
    assert.ok(imageBase64.length > 100 * 1024); // cobre limite de JSON próprio do upload
    const created = await call('/api/manual', 'POST', { ...fields, imageBase64 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const o = created.body; id = o.id;
    assert.equal(o.source, 'manual'); assert.equal(o.status, 'preparada');
    assert.equal(o.affiliateLink, link); assert.equal(o.priceMin, 80);
    assert.match(o.caption, /📉 20,0% de desconto!/); assert.ok(o.caption.includes(link));
    assert.equal(o.sameVariant, true);
    assert.match(o.caption, /CASA10.*Compra mínima/); assert.match(o.caption, /Variante azul/);
    assert.ok((await call('/api/offers')).body.offers.some(row => row.id === id));
    const finalized = await call(`/api/offers/${id}/finalize`, 'POST');
    assert.equal(finalized.body.refreshed, false); assert.equal(finalized.body.offer.caption, o.caption);
    const invalid = await call('/api/manual', 'POST', { ...fields, imageBase64: Buffer.from('not an image').toString('base64') });
    assert.equal(invalid.status, 400);
    assert.equal((await call('/api/offers')).body.offers.length, 1);
    for (const patch of [{ name: '' }, { affiliateLink: 'https://shopee.com.br.evil.com/item' }, { priceMin: '-1' }, { priceMin: 'Infinity' }, { priceMax: '50' }, { coupon: '' }]) {
      assert.equal((await call(`/api/manual/${id}`, 'PUT', { ...fields, ...patch })).status, 400);
    }
    assert.equal((await call('/api/manual', 'POST', { ...fields, imageUrl: 'https://[::ffff:127.0.0.1]/image.jpg' })).status, 400);
    assert.equal((await call(`/api/manual/${id}`, 'PUT', { ...fields, imageBase64: Buffer.from('bad').toString('base64') })).status, 400);
    assert.equal((await call(`/api/offers/${id}`)).body.imageUrl, o.imageUrl);
    const edited = (await call(`/api/manual/${id}`, 'PUT', { ...fields, name: 'Produto editado', priceMin: '60', priceMax: '90' })).body;
    assert.equal(edited.name, 'Produto editado'); assert.equal(edited.imageUrl, o.imageUrl);
    assert.doesNotMatch(edited.caption, /de desconto|Preço anterior|De R\$/); // faixa não gera percentual ambíguo
    await call(`/api/offers/${id}`, 'PATCH', { caption: 'Legenda personalizada ' + link });
    assert.equal((await call(`/api/offers/${id}/finalize`, 'POST')).body.offer.caption, 'Legenda personalizada ' + link);
    const reset = (await call(`/api/offers/${id}/caption/reset`, 'POST')).body;
    assert.match(reset.caption, /CASA10/);
    await call(`/api/offers/${id}`, 'PATCH', { status: 'publicada' });
    const copy = (await call(`/api/offers/${id}/duplicate`, 'POST')).body;
    assert.notEqual(copy.id, id); assert.equal(copy.source, 'manual'); assert.equal(copy.status, 'preparada'); assert.equal(copy.affiliateLink, link);
    const small = (await call(`/api/manual/${id}`, 'PUT', { ...fields, imageBase64: (await png(120, 60)).toString('base64') })).body;
    assert.equal(small.status, 'revisao'); assert.match(small.imageNote, /resolução baixa/);
    assert.equal((await call(`/api/offers/${id}`, 'PATCH', { status: 'preparada' })).status, 400);
    const metadata = await sharp(path.join(cfg.imagesDir, path.basename(small.imageUrl))).metadata();
    assert.equal(metadata.width, 120); assert.equal(metadata.height, 60);
    await call(`/api/manual/${id}`, 'PUT', { ...fields, imageBase64 });
    await call(`/api/offers/${id}`, 'PATCH', { status: 'descartada' });
    assert.equal((await call(`/api/offers/${id}`)).body.status, 'descartada');
    const history = (await call('/api/history')).body.history;
    assert.ok(history.some(h => h.mode === 'manual' && h.kind === 'manual'));
    assert.ok(history.some(h => h.kind === 'status' && h.message.includes('publicada')));
  } finally {
    await new Promise(resolve => server.close(resolve)); db.close();
  }
  const reopened = dbm.open(file);
  try {
    const saved = reopened.prepare('SELECT * FROM offers WHERE id=?').get(id);
    assert.equal(saved.name, fields.name); assert.equal(saved.affiliate_link, link);
    assert.equal(saved.category, 'Casa'); assert.equal(saved.status, 'descartada');
    assert.equal(saved.previous_same_variant, 1);
  } finally { reopened.close(); }
});

test('links e imagens: bloqueia IPv6 interno/mapeado, URLs falsas e formatos inválidos', async () => {
  assert.equal(validateLink(link), link);
  assert.equal(validateLink('https://shope.ee/abc?subid=x'), 'https://shope.ee/abc?subid=x');
  for (const value of ['http://shopee.com.br/item', 'https://evil.com/item', 'https://shopee.com.br/', link + '\n', 'https://user:pass@shopee.com.br/item']) assert.throws(() => validateLink(value));
  for (const ip of ['::ffff:7f00:1', '::ffff:a00:1', 'ff02::1', '2002:7f00:1::', '2001:db8::1']) assert.equal(isPrivateIp(ip), true);
  for (const value of ['https://[::1]/x', 'https://[::ffff:192.168.1.1]/x', 'https://2130706433/x']) assert.throws(() => checkUrl(value));
  await assert.rejects(() => processBuffer(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')));
  await assert.rejects(() => processBuffer(Buffer.alloc(6 * 1024 * 1024 + 1)), /grande demais/);
});

test('legenda: só calcula desconto para preço único e anterior maior', () => {
  const template = '🔥 {nome}\n💰 {preco}\n🛒 Confira: {link}';
  for (const previousPrice of [undefined, 50, 80]) assert.doesNotMatch(buildCaption(template, { name: 'Teste', priceMin: 80, priceMax: 80, previousPrice, sameVariant: true, link }), /de desconto/);
  const caption = buildCaption(template, { name: 'Teste', priceMin: 80, priceMax: 80, previousPrice: 100, sameVariant: true, link });
  assert.match(caption, /20,0%/); assert.doesNotMatch(caption, /frete|estoque|prazo/i);
});

test('migração preserva ofertas e configurações de banco anterior', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-offers-'));
  const file = path.join(dir, 'db.sqlite');
  // Cria o esquema atual, remove as colunas novas para simular versão anterior.
  const original = dbm.open(file);
  for (const key of ['previous_price', 'coupon', 'coupon_conditions', 'observations', 'category']) original.exec(`ALTER TABLE offers DROP COLUMN ${key}`);
  original.prepare('INSERT INTO offers(item_id,name,source,fetched_at,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('123', 'API existente', 'api', '2026', '2026', '2026');
  dbm.saveSettings(original, { template: 'Modelo antigo {nome} {preco} {link}' }); original.close();
  const migrated = dbm.open(file);
  try {
    assert.equal(migrated.prepare('SELECT name FROM offers').get().name, 'API existente');
    assert.equal(dbm.getSettings(migrated).template, 'Modelo antigo {nome} {preco} {link}');
    assert.ok(migrated.prepare('PRAGMA table_info(offers)').all().some(c => c.name === 'category'));
  } finally { migrated.close(); }
});

test('download por URL: aceita imagem HTTPS e revalida redirecionamentos', async t => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const { Readable } = require('node:stream');
  const { downloadImage } = require('../src/images');
  const bytes = await png(600, 800);
  let redirect = true;
  const requested = [];
  t.mock.method(https, 'get', (url, options, callback) => {
    requested.push(url.href);
    assert.equal(typeof options.lookup, 'function');
    const req = new EventEmitter();
    req.destroy = err => req.emit('error', err);
    queueMicrotask(() => {
      const res = Readable.from(redirect ? [] : [bytes]);
      res.statusCode = redirect ? 302 : 200;
      res.headers = redirect ? { location: 'https://[::ffff:127.0.0.1]/private.jpg' } : { 'content-length': bytes.length };
      callback(res);
    });
    return req;
  });
  await assert.rejects(() => downloadImage('https://images.example.com/product.jpg'), /não permitido/);
  assert.equal(requested.length, 1); // não abre conexão ao destino interno
  redirect = false;
  assert.deepEqual(await downloadImage('https://images.example.com/product.jpg'), bytes);
  const db = dbm.open(':memory:');
  const cfg = { imagesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'manual-url-')) };
  try {
    const { saveManual } = require('../src/manual');
    const offer = await saveManual({ db, cfg, body: { ...fields, imageUrl: 'https://images.example.com/product.jpg' } });
    assert.equal(offer.status, 'preparada');
    assert.ok(fs.existsSync(path.join(cfg.imagesDir, offer.image_file)));
    assert.equal(offer.affiliate_link, link);
  } finally { db.close(); }
});
