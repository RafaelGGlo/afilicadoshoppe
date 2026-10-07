import { shopeeQuery } from './shopee-api.js';
export function marketplaceUrl(raw, platform) {
  const u = new URL(raw);
  const hosts = platform === 'shopee' ? ['shopee.com.br', 's.shopee.com.br', 'shope.ee'] : ['mercadolivre.com.br', 'mercadolivre.com', 'meli.la'];
  if (u.protocol !== 'https:' || u.username || u.password || !hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) throw Error('Invalid marketplace URL');
  return u.href;
}
export async function affiliateLink(deal, env = process.env, request = fetch) {
  if (!['shopee', 'ml'].includes(deal.platform)) throw Error('Unknown platform');
  if (deal.testOnly === true) return marketplaceUrl(deal.productUrl, deal.platform);
  if (deal.affiliateUrl) return marketplaceUrl(deal.affiliateUrl, deal.platform);
  const url = marketplaceUrl(deal.productUrl, deal.platform);
  if (deal.platform === 'ml') {
    if (!env.ML_CONVERTER_URL) throw Error('ML requires affiliateUrl from Central de Afiliados or your converter');
    if (new URL(env.ML_CONVERTER_URL).protocol !== 'https:') throw Error('Converter must use HTTPS');
    const response = await request(env.ML_CONVERTER_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(env.ML_CONVERTER_TOKEN ? { Authorization: `Bearer ${env.ML_CONVERTER_TOKEN}` } : {}) },
      body: JSON.stringify({ url, tag: env.AFFILIATE_TAG_ML || '' }), signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!response.ok) throw Error(`ML converter HTTP ${response.status}`);
    return marketplaceUrl((await response.json()).affiliateUrl, 'ml');
  }
  if (!env.SHOPEE_APP_ID || !env.SHOPEE_SECRET) throw Error('Shopee API credentials required');
  const subIds = env.AFFILIATE_TAG_SHOPEE ? [env.AFFILIATE_TAG_SHOPEE] : [];
  const query = `mutation { generateShortLink(input: {originUrl: ${JSON.stringify(url)}, subIds: ${JSON.stringify(subIds)}}) { shortLink } }`;
  const data = await shopeeQuery(query, env, request);
  if (!data.generateShortLink?.shortLink) throw Error('Shopee conversion failed; check API access/schema');
  return marketplaceUrl(data.generateShortLink.shortLink, 'shopee');
}
