const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const dbm = require('../src/db');
const images = require('../src/images');
const offers = require('../src/offers');
const { ShopeeError } = require('../src/shopee');

const cfg = () => ({ imagesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'img-')) });
const node = (id, extra = {}) => ({ itemId: String(id), shopId: '1', name: `Produto ${id}`, priceMin: 50, priceMax: 50, imageUrl: 'https://img/x.jpg', productLink: `https://shopee.com.br/p${id}`, offerLink: `https://s/o${id}`, ...extra });

function fakeClient(nodesByKeyword, { failLink = false } = {}) {
  const calls = { search: 0, link: 0 };
  return {
    calls,
    async searchProducts({ keyword, itemId }) {
      calls.search++;
      if (itemId) return { nodes: (nodesByKeyword.__byId?.[itemId] ? [nodesByKeyword.__byId[itemId]] : []), hasNextPage: false };
      const v = nodesByKeyword[keyword];
      if (v instanceof Error) throw v;
      return { nodes: v || [], hasNextPage: false };
    },
    async generateShortLink(url) { calls.link++; if (failLink) throw new Error('falhou'); return url.replace('shopee.com.br', 's.shopee.com.br') + '?aff'; },
  };
}

function setup(opts) {
  const db = dbm.open(':memory:');
  dbm.saveSettings(db, { keywords: ['a'], dedupeDays: 14, maxPerRun: 10, ...opts });
  return db;
}

// Troca o download de imagem por um stub (sem rede). Retorna função para restaurar.
function stubImages(result = { status: 'ok', file: 'x.jpg', note: '800x800' }) {
  const orig = images.fetchApiImage;
  images.fetchApiImage = async () => result;
  return () => { images.fetchApiImage = orig; };
}

test('cria oferta preparada com link de afiliado, imagem e legenda; registra data da consulta', async () => {
  const restore = stubImages();
  const db = setup();
  const s = await offers.runSearch({ db, client: fakeClient({ a: [node(1)] }), cfg: cfg() });
  restore();
  assert.equal(s.created, 1);
  const o = offers.listOffers(db)[0];
  assert.equal(o.status, 'preparada');
  assert.equal(o.source, 'api');
  assert.match(o.affiliate_link, /s\.shopee\.com\.br\/p1\?aff/);
  assert.match(o.caption, /Produto 1/);
  assert.ok(o.fetched_at);
});

test('prevenção de duplicação: mesmo produto em outra consulta e dentro da mesma consulta', async () => {
  const restore = stubImages();
  const db = setup({ keywords: ['a', 'b'] });
  const client = fakeClient({ a: [node(1), node(2)], b: [node(2), node(3)] });
  const s1 = await offers.runSearch({ db, client, cfg: cfg() });
  assert.equal(s1.created, 3); assert.equal(s1.skippedDuplicate, 1);
  const s2 = await offers.runSearch({ db, client, cfg: cfg() });
  assert.equal(s2.created, 0); assert.equal(s2.skippedDuplicate, 4);
  restore();
});

test('janela de repetição configurável: produto antigo pode voltar', async () => {
  const restore = stubImages();
  const db = setup({ dedupeDays: 7 });
  const client = fakeClient({ a: [node(1)] });
  await offers.runSearch({ db, client, cfg: cfg() });
  db.prepare('UPDATE offers SET created_at = ?').run(new Date(Date.now() - 8 * 86400000).toISOString());
  assert.equal((await offers.runSearch({ db, client, cfg: cfg() })).created, 1);
  restore();
});

test('descartar não libera o produto para repetir dentro da janela', async () => {
  const restore = stubImages();
  const db = setup();
  const client = fakeClient({ a: [node(1)] });
  await offers.runSearch({ db, client, cfg: cfg() });
  offers.setStatus(db, offers.listOffers(db)[0].id, 'descartada');
  assert.equal((await offers.runSearch({ db, client, cfg: cfg() })).created, 0);
  restore();
});

test('filtro de faixa de preço e limite por consulta', async () => {
  const restore = stubImages();
  const db = setup({ priceMin: 20, priceMax: 100, maxPerRun: 2 });
  const nodes = [node(1, { priceMin: 10, priceMax: 10 }), node(2, { priceMin: 150, priceMax: 200 }), node(3), node(4), node(5)];
  const s = await offers.runSearch({ db, client: fakeClient({ a: nodes }), cfg: cfg() });
  restore();
  assert.equal(s.skippedPrice, 2); assert.equal(s.created, 2);
});

test('variantes: faixa de preço aparece corretamente na legenda', async () => {
  const restore = stubImages();
  const db = setup();
  await offers.runSearch({ db, client: fakeClient({ a: [node(1, { priceMin: 30, priceMax: 80 })] }), cfg: cfg() });
  restore();
  assert.match(offers.listOffers(db)[0].caption.replace(/\u00a0/g, ' '), /A partir de R\$ 30,00 — varia até R\$ 80,00/);
});

test('sem imagem adequada: marca para revisão', async () => {
  const restore = stubImages({ status: 'none', file: null, note: 'A API não retornou imagem' });
  const db = setup();
  await offers.runSearch({ db, client: fakeClient({ a: [node(1, { imageUrl: null })] }), cfg: cfg() });
  restore();
  const o = offers.listOffers(db)[0];
  assert.equal(o.status, 'revisao'); assert.match(o.review_reason, /imagem/);
});

test('imagem enviada manualmente tira a oferta da revisão', async () => {
  const restore = stubImages({ status: 'none', file: null, note: '' });
  const db = setup(); const c = cfg();
  await offers.runSearch({ db, client: fakeClient({ a: [node(1)] }), cfg: c });
  restore();
  const id = offers.listOffers(db)[0].id;
  const buf = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#0f0' } }).png().toBuffer();
  const o = await offers.attachManualImage({ db, cfg: c, id, buffer: buf });
  assert.equal(o.image_status, 'manual'); assert.equal(o.status, 'preparada');
  assert.ok(fs.existsSync(path.join(c.imagesDir, o.image_file)));
  await assert.rejects(() => offers.attachManualImage({ db, cfg: c, id, buffer: Buffer.from('lixo') }), /não é uma imagem/);
});

test('generateShortLink falha: usa offerLink da API e avisa', async () => {
  const restore = stubImages();
  const db = setup();
  await offers.runSearch({ db, client: fakeClient({ a: [node(1)] }, { failLink: true }), cfg: cfg() });
  restore();
  const o = offers.listOffers(db)[0];
  assert.equal(o.affiliate_link, 'https://s/o1');
  assert.match(o.review_reason || '', /offerLink/);
});

test('sem NENHUM link de afiliado: não grava a oferta (não bloqueia o produto por falha passageira) e registra o erro', async () => {
  const restore = stubImages();
  const db = setup();
  const client = fakeClient({ a: [node(2, { offerLink: null })] }, { failLink: true });
  const s1 = await offers.runSearch({ db, client, cfg: cfg() });
  assert.equal(s1.created, 0); assert.equal(s1.errors.length, 1);
  assert.equal(offers.listOffers(db).length, 0);
  assert.ok(db.prepare("SELECT 1 FROM history WHERE kind='erro'").get());
  // quando o link voltar a funcionar, o produto pode ser preparado normalmente
  const s2 = await offers.runSearch({ db, client: fakeClient({ a: [node(2, { offerLink: null })] }), cfg: cfg() });
  restore();
  assert.equal(s2.created, 1);
  assert.equal(offers.listOffers(db)[0].status, 'preparada');
});

test('API sem link do produto nem offerLink: oferta vai para revisão (sem link)', async () => {
  const restore = stubImages();
  const db = setup();
  const s = await offers.runSearch({ db, client: fakeClient({ a: [node(3, { productLink: null, offerLink: null })] }), cfg: cfg() });
  restore();
  assert.equal(s.created, 1);
  const o = offers.listOffers(db)[0];
  assert.equal(o.status, 'revisao'); assert.match(o.review_reason, /link/i);
});

test('falha de credencial (10020) interrompe a consulta, registra erro e não cria nada', async () => {
  const db = setup({ keywords: ['a', 'b'] });
  const client = fakeClient({ a: new ShopeeError('cred', { code: 10020 }), b: [node(9)] });
  const s = await offers.runSearch({ db, client, cfg: cfg() });
  assert.equal(s.created, 0); assert.equal(s.errors.length, 1);
  assert.equal(client.calls.search, 1); // não insistiu na segunda palavra-chave
  assert.ok(db.prepare("SELECT 1 FROM history WHERE kind='erro'").get());
});

test('falha em uma palavra-chave não impede as outras', async () => {
  const restore = stubImages();
  const db = setup({ keywords: ['a', 'b'] });
  const s = await offers.runSearch({ db, client: fakeClient({ a: new ShopeeError('rede', {}), b: [node(7)] }), cfg: cfg() });
  restore();
  assert.equal(s.created, 1); assert.equal(s.errors.length, 1);
});

test('sem palavras-chave: erro claro', async () => {
  const db = setup({ keywords: [] });
  const s = await offers.runSearch({ db, client: fakeClient({}), cfg: cfg() });
  assert.match(s.errors[0], /Nenhuma palavra-chave/);
});

test('MODO DEMO: ofertas simuladas ficam marcadas, em revisão, sem link real', async () => {
  const db = setup();
  const s = await offers.runSearch({ db, client: null, cfg: cfg() });
  assert.equal(s.mode, 'demo'); assert.ok(s.created > 0);
  for (const o of offers.listOffers(db)) {
    assert.equal(o.source, 'demo'); assert.equal(o.status, 'revisao'); assert.equal(o.affiliate_link, null); assert.match(o.name, /\[DEMO\]/);
  }
  const o = offers.listOffers(db)[0];
  assert.throws(() => offers.setStatus(db, o.id, 'preparada'), /DEMONSTRAÇÃO/);
  assert.equal((await offers.refreshOffer({ db, client: null, cfg: cfg(), id: o.id })).refreshed, false);
});

test('atualização antes de publicar: preço novo reflete na legenda; produto sumido vai para revisão', async () => {
  const restore = stubImages();
  const db = setup();
  const client = fakeClient({ a: [node(1), node(2)], __byId: { 1: node(1, { priceMin: 39, priceMax: 39, name: 'Produto 1 novo' }) } });
  await offers.runSearch({ db, client, cfg: cfg() });
  restore();
  const [o2, o1] = offers.listOffers(db);
  const r1 = await offers.refreshOffer({ db, client, cfg: cfg(), id: o1.id });
  assert.equal(r1.refreshed, true); assert.equal(r1.offer.price_min, 39); assert.match(r1.offer.caption, /Produto 1 novo/);
  const r2 = await offers.refreshOffer({ db, client, cfg: cfg(), id: o2.id });
  assert.equal(r2.offer.status, 'revisao'); assert.match(r2.offer.review_reason, /não encontrado/);
});

test('publicada/descartada nunca são alteradas pela atualização automática', async () => {
  const restore = stubImages();
  const db = setup();
  const client = fakeClient({ a: [node(1)], __byId: {} });
  await offers.runSearch({ db, client, cfg: cfg() });
  restore();
  const id = offers.listOffers(db)[0].id;
  offers.setStatus(db, id, 'publicada');
  await offers.refreshOffer({ db, client, cfg: cfg(), id });
  assert.equal(offers.getOffer(db, id).status, 'publicada');
});

test('status inválido e legenda editada/refeita', async () => {
  const restore = stubImages();
  const db = setup();
  await offers.runSearch({ db, client: fakeClient({ a: [node(1)] }), cfg: cfg() });
  restore();
  const id = offers.listOffers(db)[0].id;
  assert.throws(() => offers.setStatus(db, id, 'enviada'), /inválido/);
  offers.setCaption(db, id, 'texto meu');
  assert.equal(offers.getOffer(db, id).caption, 'texto meu');
  assert.match(offers.resetCaption(db, id).caption, /OFERTA SHOPEE/);
});
