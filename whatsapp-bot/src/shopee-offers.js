import { shopeeQuery } from './shopee-api.js';
import { marketplaceUrl } from './affiliates.js';
import { configuredCategories, matchesOfferFilter, configuredOfferMode, assertSupportedOfferMode, hasApiDiscount, configuredMinSales, matchesSalesFilter } from './offer-filter.js';
import { searchCounters } from './report.js';

export function createShopeeSource({ env = process.env, request = fetch, pageSize = 30, maxPages = 5 } = {}) {
 const categories = configuredCategories(env), offerMode = configuredOfferMode(env), minimumSales = configuredMinSales(env);
 const searches = categories.length ? categories : [null], pages = searches.map(() => 1);
 let categoryIndex = 0;
 return async function searchOffers({ limit = 1, isAlreadySent = () => false, isDeferred = () => false, onSearchSummary = () => {} } = {}) {
  assertSupportedOfferMode(offerMode);
  const deals = [], seen = new Set(), stats = searchCounters();
  try {
   for (let searched = 0; searched < maxPages; searched++) {
    const searchIndex = categoryIndex, page = pages[searchIndex], category = searches[searchIndex];
    const categoryArgument = category === null ? '' : ', productCatId: ' + category;
    const query = '{ productOfferV2(page: ' + page + ', limit: ' + pageSize + categoryArgument + ') { nodes { itemId shopId productName productLink imageUrl priceMin priceMax offerLink productCatIds priceDiscountRate sales } pageInfo { hasNextPage } } }';
    const data = await shopeeQuery(query, env, request);
    const result = data.productOfferV2;
    if (!Array.isArray(result?.nodes) || typeof result.pageInfo?.hasNextPage !== 'boolean') throw Error('Invalid Shopee offers response');
    stats.pages++; stats.consulted += result.nodes.length;
    pages[searchIndex] = result.pageInfo.hasNextPage ? page + 1 : 1;
    categoryIndex = (categoryIndex + 1) % searches.length;
    for (const product of result.nodes) {
     stats.evaluated++;
     const id = 'shopee:' + product.shopId + ':' + product.itemId;
     if (seen.has(id)) { stats.duplicate++; continue; }
     if (isAlreadySent(id)) { stats.alreadySent++; continue; }
     if (isDeferred(id)) { stats.cooldown++; continue; }
     if (offerMode === 'discount-only' && !hasApiDiscount(product.priceDiscountRate)) { stats.noDiscount++; continue; }
     if (!matchesSalesFilter(product.sales, minimumSales)) { stats.lowSales++; continue; }
     try {
      if (![product.shopId, product.itemId].every(value => /^\d+$/.test(String(value)))) { stats.invalid++; continue; }
      const price = Number(product.priceMin), maximum = Number(product.priceMax);
      if (!product.productName?.trim() || !Number.isFinite(price) || price <= 0) { stats.invalid++; continue; }
      const image = new URL(product.imageUrl);
      if (image.protocol !== 'https:' || image.username || image.password) { stats.invalid++; continue; }
      const deal = { id, platform: 'shopee', title: product.productName, price,
       fromPrice: Number.isFinite(maximum) && maximum > price,
       discountRate: hasApiDiscount(product.priceDiscountRate) ? Number(product.priceDiscountRate) : undefined,
       sales: product.sales !== null && product.sales !== undefined && /^\d+$/.test(String(product.sales)) && Number.isSafeInteger(Number(product.sales)) ? Number(product.sales) : undefined,
       categoryIds: product.productCatIds, headline: env.OFFER_HEADLINE || '',
       productUrl: marketplaceUrl(product.productLink, 'shopee'), affiliateUrl: marketplaceUrl(product.offerLink, 'shopee'), imageUrl: image.href, active: true };
      if (!matchesOfferFilter(deal, categories)) { stats.filtered++; continue; }
      stats.valid++; deals.push(deal); seen.add(id);
      if (deals.length >= limit) { pages[searchIndex] = page; return deals; }
     } catch { stats.invalid++; }
    }
    if (!result.pageInfo.hasNextPage && searches.length === 1) break;
   }
   return deals;
  } catch (error) { stats.apiErrors++; throw error; }
  finally { onSearchSummary({ ...stats }); }
 };
}
