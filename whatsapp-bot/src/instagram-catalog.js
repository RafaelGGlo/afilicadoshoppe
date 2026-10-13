import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '../..');
export const catalogFile = path.join(root, 'whatsapp-bot/instagram-offers.json');
export function instagramProductKey(offer) {
 if (offer.productKey) return offer.productKey;
 if (/^shopee:\d+:\d+$/.test(offer.id || '')) return offer.id;
 try {
  const url = new URL(offer.productUrl || offer.productLink);
  const shopee = /\/(?:product\/)?(\d+)\/(\d+)(?:\/|$)/.exec(url.pathname) || /-i\.(\d+)\.(\d+)/.exec(url.pathname);
  if ((url.hostname === 'shopee.com.br' || url.hostname.endsWith('.shopee.com.br')) && shopee) return `shopee:${shopee[1]}:${shopee[2]}`;
  const ml = /MLB-?(\d+)/i.exec(url.pathname);
  if (ml && /mercadolivre\.com/.test(url.hostname)) return 'ml:' + ml[1];
 } catch { /* stable source ID remains the fallback */ }
 return offer.id;
}
// Best effort observer: never make WhatsApp delivery depend on Instagram storage.
export function captureInstagramOffers(deals, file = catalogFile) {
 try {
  const rows = deals.filter(d => d.active !== false).slice(0, 500).map(d => ({
   id: String(d.id || d.productUrl), title: String(d.title || '').slice(0, 300), price: d.price,
   previousPrice: d.previousPrice, discountRate: d.discountRate, imageUrl: d.imageUrl,
   affiliateUrl: d.affiliateUrl, productKey: instagramProductKey(d), platform: d.platform, expiresAt: d.expiresAt, testOnly: d.testOnly === true,
  }));
  fs.writeFileSync(file + '.tmp', JSON.stringify(rows), { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
 } catch { /* isolated from existing search and send behavior */ }
}
export function readInstagramOffers() {
 const result = new Map();
 for (const file of [path.join(root, 'whatsapp-bot/deals.json'), catalogFile]) {
  try { for (const d of JSON.parse(fs.readFileSync(file, 'utf8'))) {
   if (d.active === false || (d.expiresAt && Date.parse(d.expiresAt) <= Date.now())) continue;
   const id = String(d.id || d.productUrl || '');
   if (id && d.title && Number(d.price) > 0) result.set(id, { ...d, id, title: String(d.title).slice(0, 300), price: Number(d.price) });
  } } catch { /* source may not exist yet */ }
 }
 let db;
 try {
  const file = path.join(root, 'data/ofertas.db');
  if (fs.existsSync(file)) {
   db = new DatabaseSync(file, { readOnly: true });
   for (const o of db.prepare("SELECT * FROM offers WHERE status NOT IN ('descartada','cancelled') ORDER BY id DESC LIMIT 500").all()) {
    const id = 'offers:' + o.id;
    if (o.price_min > 0) result.set(id, { id, title: o.name, price: o.price_min, previousPrice: o.previous_same_variant === 1 ? o.previous_price : null,
     imageFile: o.image_file ? path.join(root, 'data/images', path.basename(o.image_file)) : null,
     imageUrl: o.api_image_url, affiliateUrl: o.affiliate_link, platform: o.source, caption: o.caption,
     productKey: instagramProductKey({ id, productUrl: o.product_link, ...(o.shop_id && /^\d+$/.test(o.item_id) ? { productKey: `shopee:${o.shop_id}:${o.item_id}` } : {}) }),
     testOnly: o.source === 'demo' || /^\[DEMO\]/.test(o.name) });
   }
  }
 } catch { /* do not migrate or write the existing database */ } finally { db?.close(); }
 return [...result.values()].filter(d => d.imageFile || d.imageUrl).slice(0, 500);
}
