import { shopeeQuery } from './shopee-api.js';
import { marketplaceUrl } from './affiliates.js';
import { configuredCategories, matchesOfferFilter, configuredOfferMode, assertSupportedOfferMode, hasApiDiscount, configuredMinSales, matchesSalesFilter } from './offer-filter.js';

export function createShopeeSource({ env = process.env, request = fetch, pageSize = 30, maxPages = 5 } = {}) {
  const categories = configuredCategories(env);
  const offerMode = configuredOfferMode(env);
  const minimumSales = configuredMinSales(env);
  const searches = categories.length ? categories : [null];
  const pages = searches.map(() => 1);
  let categoryIndex = 0;
  return async function searchOffers({ limit = 1, isAlreadySent = () => false } = {}) {
    assertSupportedOfferMode(offerMode);
    const deals = [];
    const seen = new Set();
    for (let searched = 0; searched < maxPages; searched++) {
      const searchIndex = categoryIndex;
      const page = pages[searchIndex];
      const category = searches[searchIndex];
      const categoryArgument = category === null ? '' : `, productCatId: ${category}`;
      const data = await shopeeQuery(`{ productOfferV2(page: ${page}, limit: ${pageSize}${categoryArgument}) { nodes { itemId shopId productName productLink imageUrl priceMin priceMax offerLink productCatIds priceDiscountRate sales } pageInfo { hasNextPage } } }`, env, request);
      const result = data.productOfferV2;
      if (!Array.isArray(result?.nodes) || typeof result.pageInfo?.hasNextPage !== 'boolean') throw Error('Invalid Shopee offers response');
      pages[searchIndex] = result.pageInfo.hasNextPage ? page + 1 : 1;
      categoryIndex = (categoryIndex + 1) % searches.length;
      for (const product of result.nodes) {
        const id = `shopee:${product.shopId}:${product.itemId}`;
        if (seen.has(id) || isAlreadySent(id)) continue;
        if (offerMode === 'discount-only' && !hasApiDiscount(product.priceDiscountRate)) continue;
        if (!matchesSalesFilter(product.sales, minimumSales)) continue;
        try {
          if (![product.shopId, product.itemId].every(value => /^\d+$/.test(String(value)))) continue;
          const price = Number(product.priceMin);
          const maximum = Number(product.priceMax);
          if (!product.productName?.trim() || !Number.isFinite(price) || price <= 0) continue;
          const image = new URL(product.imageUrl);
          if (image.protocol !== 'https:' || image.username || image.password) continue;
          const deal = {
            id, platform: 'shopee', title: product.productName, price,
            fromPrice: Number.isFinite(maximum) && maximum > price,
            discountRate: hasApiDiscount(product.priceDiscountRate) ? Number(product.priceDiscountRate) : undefined,
            sales: product.sales !== null && product.sales !== undefined && /^\d+$/.test(String(product.sales)) && Number.isSafeInteger(Number(product.sales)) ? Number(product.sales) : undefined,
            categoryIds: product.productCatIds,
            headline: env.OFFER_HEADLINE || '',
            productUrl: marketplaceUrl(product.productLink, 'shopee'),
            affiliateUrl: marketplaceUrl(product.offerLink, 'shopee'),
            imageUrl: image.href, active: true,
          };
          if (!matchesOfferFilter(deal, categories)) continue;
          deals.push(deal);
          seen.add(id);
          if (deals.length >= limit) {
            // Revisit this page next cycle; history skips products already sent.
            pages[searchIndex] = page;
            return deals;
          }
        } catch { /* Ignore malformed products without publishing remote data. */ }
      }
      if (!result.pageInfo.hasNextPage && searches.length === 1) break;
    }
    return deals;
  };
}
