// Category IDs verified against the Shopee productOfferV2 API.
export const ELECTRONICS_CATEGORIES = [100535, 100013, 100644, 100634, 100635];

export function configuredMinSales(env = process.env) {
  const value = env.SHOPEE_MIN_SALES ?? '0';
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw Error('Invalid SHOPEE_MIN_SALES');
  return Number(value);
}

export function matchesSalesFilter(sales, minimum = 0) {
  if (minimum === 0) return true;
  if (sales === null || sales === undefined || !/^\d+$/.test(String(sales))) return false;
  return Number.isSafeInteger(Number(sales)) && Number(sales) >= minimum;
}

export function configuredOfferMode(env = process.env) {
  const mode = env.SHOPEE_OFFER_MODE || 'regular';
  if (!['regular', 'discount-only', 'flash-only'].includes(mode)) throw Error('Invalid SHOPEE_OFFER_MODE');
  return mode;
}

export function hasApiDiscount(value) {
  if (value === null || value === undefined || value === '') return false;
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 && rate < 100;
}

export function assertSupportedOfferMode(mode) {
  // The verified Affiliate API contract exposes no product-level flash-sale proof.
  // Discounts and affiliate campaign periods do not establish flash-sale membership.
  if (mode === 'flash-only') throw Error('Flash-sale search unavailable: Affiliate API does not confirm product flash-sale membership');
}

export function configuredCategories(env = process.env) {
  const values = (env.SHOPEE_CATEGORY_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (values.some(value => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)) {
    throw Error('Invalid SHOPEE_CATEGORY_IDS');
  }
  return [...new Set(values.map(Number))];
}

export function matchesOfferFilter(deal, categories = []) {
  if (!categories.length) return true;
  if (deal.platform !== 'shopee' || !Array.isArray(deal.categoryIds) || !deal.categoryIds.some(id => categories.includes(Number(id)))) return false;
  // Passive accessories sometimes appear inside electronics categories.
  const title = String(deal.title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return !/\b(capa|capas|capinha|capinhas|pelicula|peliculas|flanela|flanelas|limpa telas|limpa tela|organizador de cabos|organizadores de cabos|plaquinha|plaquinhas|adesivo|adesivos|camiseta|camisetas|bermuda|bermudas|pasta de amendoim)\b/.test(title);
}
