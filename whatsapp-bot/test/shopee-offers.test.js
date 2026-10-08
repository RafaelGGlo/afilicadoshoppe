import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShopeeSource } from '../src/shopee-offers.js';
import { matchesOfferFilter, configuredCategories, configuredOfferMode, assertSupportedOfferMode, configuredMinSales, matchesSalesFilter } from '../src/offer-filter.js';
const env = { SHOPEE_APP_ID: 'app', SHOPEE_SECRET: 'secret' };
const product = itemId => ({ itemId, shopId: 99, productName: 'Produto', priceMin: '29.9', priceMax: '39.9', productLink: `https://shopee.com.br/product/99/${itemId}`, offerLink: 'https://s.shopee.com.br/abc', imageUrl: 'https://cf.shopee.com.br/file/image' });
const response = (nodes, hasNextPage = false) => ({ ok: true, json: async () => ({ data: { productOfferV2: { nodes, pageInfo: { hasNextPage } } } }) });

test('automatic search skips sent products and retains real prices, photos and affiliate links', async () => {
  const source = createShopeeSource({ env, request: async () => response([product(1), product(2), product(3)]) });
  const [deal] = await source({ isAlreadySent: id => id === 'shopee:99:1' });
  assert.equal(deal.id, 'shopee:99:2');
  assert.equal(deal.price, 29.9);
  assert.equal(deal.fromPrice, true);
  assert.equal(deal.affiliateUrl, 'https://s.shopee.com.br/abc');
  assert.equal(deal.imageUrl, 'https://cf.shopee.com.br/file/image');
  assert.equal((await source({ isAlreadySent: id => ['shopee:99:1', deal.id].includes(id) }))[0].id, 'shopee:99:3');
});
test('search advances past exhausted pages and bounds requests when all offers were sent', async () => {
  const pages = [];
  const source = createShopeeSource({ env, maxPages: 2, request: async (_, options) => {
    const page = Number(JSON.parse(options.body).query.match(/page: (\d+)/)[1]);
    pages.push(page);
    return response([product(page)], true);
  } });
  assert.equal((await source({ isAlreadySent: id => id === 'shopee:99:1' }))[0].id, 'shopee:99:2');
  assert.deepEqual(pages, [1, 2]);
  pages.length = 0;
  assert.deepEqual(await source({ isAlreadySent: () => true }), []);
  assert.equal(pages.length, 2);
});
test('invalid products and API failures never produce offers', async () => {
  const source = createShopeeSource({ env, request: async () => response([
    { ...product(1), priceMin: 'NaN' }, { ...product(2), offerLink: 'https://example.com/link' },
    { ...product(3), imageUrl: 'http://example.com/image' }, product(4), product(4),
  ]) });
  assert.deepEqual((await source({ limit: 10 })).map(deal => deal.id), ['shopee:99:4']);
  await assert.rejects(createShopeeSource({ env, request: async () => ({ ok: true, json: async () => ({ errors: [{ message: 'remote secret' }] }) }) })(), { code: 'SHOPEE_AUTH' });
});

test('electronics search sends API category filters and rejects wrong categories and passive accessories', async () => {
  const queries = [];
  const source = createShopeeSource({ env: { ...env, SHOPEE_CATEGORY_IDS: '100535,100634' }, request: async (_, options) => {
    const query = JSON.parse(options.body).query;
    queries.push(query);
    return response([
      { ...product(1), productName: 'Bermuda', productCatIds: [100017] },
      { ...product(2), productName: 'Capinha para celular', productCatIds: [100535] },
      { ...product(3), productName: 'Fone Bluetooth', productCatIds: [100535, 100578] },
    ]);
  } });
  assert.equal((await source())[0].id, 'shopee:99:3');
  assert.match(queries[0], /productCatId: 100535/);
  await source();
  assert.match(queries[1], /productCatId: 100634/);
  assert.equal(matchesOfferFilter({ platform: 'shopee', title: 'Fone Bluetooth' }, [100535]), false);
  assert.equal(matchesOfferFilter({ platform: 'ml', title: 'Fone', categoryIds: [100535] }, [100535]), false);
  assert.throws(() => configuredCategories({ SHOPEE_CATEGORY_IDS: '100535,invalid' }));
});

test('flash-only mode blocks ordinary API offers and manual sends rather than inventing flash-sale status', async () => {
  let requests = 0;
  const source = createShopeeSource({ env: { ...env, SHOPEE_OFFER_MODE: 'flash-only' }, request: async () => { requests++; return response([product(1)]); } });
  await assert.rejects(source(), /does not confirm product flash-sale membership/);
  assert.equal(requests, 0);
  assert.throws(() => assertSupportedOfferMode('flash-only'));
  assert.doesNotThrow(() => assertSupportedOfferMode('regular'));
  assert.throws(() => configuredOfferMode({ SHOPEE_OFFER_MODE: 'invalid' }));
});

test('discount-only mode searches all categories and only returns API-reported discounts', async () => {
  const queries = [];
  const source = createShopeeSource({ env: { ...env, SHOPEE_OFFER_MODE: 'discount-only', SHOPEE_CATEGORY_IDS: '' }, request: async (_, options) => {
    queries.push(JSON.parse(options.body).query);
    return response([
      ...[undefined, null, '', 'invalid', 0, -1, 100].map((priceDiscountRate, i) => ({ ...product(i + 1), priceDiscountRate })),
      { ...product(20), productName: 'Bermuda', productCatIds: [100017], priceDiscountRate: '25' },
      { ...product(21), productName: 'Pasta de Amendoim', productCatIds: [100629], priceDiscountRate: 10 },
    ]);
  } });
  const deals = await source({ limit: 10 });
  assert.deepEqual(deals.map(deal => deal.id), ['shopee:99:20', 'shopee:99:21']);
  assert.equal(deals[0].discountRate, 25);
  assert.equal(deals[0].oldPrice, undefined);
  assert.doesNotMatch(queries[0], /productCatId:/);
  assert.match(queries[0], /priceDiscountRate/);
});

test('minimum sales keeps only discounted products with at least 5000 API-reported sales', async () => {
 const source = createShopeeSource({ env: { ...env, SHOPEE_OFFER_MODE: 'discount-only', SHOPEE_MIN_SALES: '5000' }, request: async (_, options) => {
   assert.match(JSON.parse(options.body).query, /\bsales\b/);
   return response([
     ...[null, undefined, 'invalid', 4999, -1, 5000.5].map((sales, i) => ({ ...product(i + 1), sales, priceDiscountRate: 20 })),
     { ...product(20), sales: 5000, priceDiscountRate: 20 },
     { ...product(21), sales: '10000', priceDiscountRate: 30 },
     { ...product(22), sales: 20000, priceDiscountRate: 0 },
   ]);
 } });
 const deals = await source({ limit: 10 });
 assert.deepEqual(deals.map(deal => [deal.id, deal.sales]), [['shopee:99:20', 5000], ['shopee:99:21', 10000]]);
 assert.equal(matchesSalesFilter(undefined, 5000), false);
 assert.equal(matchesSalesFilter(4999, 5000), false);
 assert.equal(configuredMinSales({ SHOPEE_MIN_SALES: '5000' }), 5000);
 assert.throws(() => configuredMinSales({ SHOPEE_MIN_SALES: '-1' }));
});
