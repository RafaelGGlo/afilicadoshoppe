import 'dotenv/config';
import { createShopeeSource } from './shopee-offers.js';
import { downloadImage } from './media.js';
import { formatDeal } from './format.js';

const deals = await createShopeeSource()({ limit: 1 });
if (!deals.length) throw Error('Shopee returned no valid offers');
const deal = deals[0];
const image = await downloadImage(deal.imageUrl);
console.log(formatDeal(deal, deal.affiliateUrl));
console.log(`\nFoto validada: ${image.length} bytes. Prévia sem envio ao WhatsApp.`);
