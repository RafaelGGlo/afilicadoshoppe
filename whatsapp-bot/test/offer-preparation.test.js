import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfferCooldown, prepareOffer } from '../src/offer-preparation.js';
import { createShopeeSource } from '../src/shopee-offers.js';
import { downloadImage } from '../src/media.js';

const ttl = 30 * 60000;
const env = { SHOPEE_APP_ID: 'test', SHOPEE_SECRET: 'test' };
const product = itemId => ({ itemId, shopId: 99, productName: 'Produto ' + itemId,
  priceMin: '10', priceMax: '10', productLink: 'https://shopee.com.br/product/99/' + itemId,
  offerLink: 'https://s.shopee.com.br/abc', imageUrl: 'https://cf.shopee.com.br/file/' + itemId });
function fixture(t) {
  let time = 1000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offer-cooldown-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'failed.json');
  const now = () => time;
  const cooldown = new OfferCooldown(file, ttl, now);
  const search = createShopeeSource({ env, request: async () => ({ ok: true,
    json: async () => ({ data: { productOfferV2: { nodes: [product(1), product(2)], pageInfo: { hasNextPage: false } } } }),
  }) });
  const offers = () => search({ isDeferred: id => cooldown.isDeferred(id) });
  const failPhoto = async url => downloadImage(url, async () => ({ ok: false, headers: new Headers() }));
  return { cooldown, offers, file, now, advance: ms => { time += ms; }, failPhoto };
}

test('1. a failed photo defers only that offer, survives restart and is skipped during cooldown', async t => {
  const f = fixture(t);
  const [deal] = await f.offers();
  await assert.rejects(prepareOffer(deal, { cooldown: f.cooldown, fetchImage: f.failPhoto }), /Image unavailable/);
  assert.equal(f.cooldown.isDeferred(deal.id), true);
  assert.equal(f.cooldown.isDeferred('shopee:99:2'), false);
  assert.equal(new OfferCooldown(f.file, ttl, f.now).isDeferred(deal.id), true);
  assert.equal((await f.offers()).some(offer => offer.id === deal.id), false);
});

test('2. another offer can be selected and prepared while the failed offer is deferred', async t => {
  const f = fixture(t);
  const [first] = await f.offers();
  await assert.rejects(prepareOffer(first, { cooldown: f.cooldown, fetchImage: f.failPhoto }));
  const [second] = await f.offers();
  assert.equal(second.id, 'shopee:99:2');
  const prepared = await prepareOffer(second, { cooldown: f.cooldown, fetchImage: async () => Buffer.from('photo') });
  assert.ok(Buffer.isBuffer(prepared.image));
  assert.match(prepared.caption, /Produto 2/);
  assert.equal(f.cooldown.isDeferred(second.id), false);
});

test('3. the failed offer remains blocked before 30 minutes and becomes eligible at expiry', async t => {
  const f = fixture(t);
  const [first] = await f.offers();
  await assert.rejects(prepareOffer(first, { cooldown: f.cooldown, fetchImage: f.failPhoto }));
  f.advance(ttl - 1);
  assert.equal(f.cooldown.isDeferred(first.id), true);
  assert.equal((await f.offers())[0].id, 'shopee:99:2');
  f.advance(1);
  assert.equal(f.cooldown.isDeferred(first.id), false);
  f.cooldown.prune();
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')), {});
  const [retry] = await f.offers();
  assert.equal(retry.id, first.id);
  await prepareOffer(retry, { cooldown: f.cooldown, fetchImage: async () => Buffer.from('photo') });
  assert.equal(f.cooldown.isDeferred(first.id), false);
});
