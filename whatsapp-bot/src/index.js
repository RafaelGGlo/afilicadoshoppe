import fs from 'node:fs';
import cron from 'node-cron';
import pino from 'pino';
import { config } from './config.js';
import { SentStore } from './store.js';
import { affiliateLink } from './affiliates.js';
import { downloadImage } from './media.js';
import { formatDeal } from './format.js';
import { createBroadcaster } from './broadcast.js';
import { connectWhatsApp } from './whatsapp.js';
import { createShopeeSource } from './shopee-offers.js';
import { matchesOfferFilter, assertSupportedOfferMode, matchesSalesFilter } from './offer-filter.js';
const logger = pino({ level: 'info' });
// One process per directory. Lock intentionally needs manual recovery after a hard crash.
const lock = './bot.lock';
const fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
let client, task, running, stopping = false;
function release() { try { fs.unlinkSync(lock); } catch {} }
try {
 const store = new SentStore('./sent_deals.json', config.ttlMs);
 const isDealSentToGroup = (id, group) => store.isDealSentToGroup(id, group);
 const searchShopee = createShopeeSource();
 let startupPending = config.runOnStart;
 client = await connectWhatsApp(logger, () => {
   if (startupPending) { startupPending = false; tick(); }
 });
 const broadcast = createBroadcaster({ store, ...config, getSocket: client.getSocket, logger });
 async function cycle() {
   if (!client.getSocket()) return;
   try { assertSupportedOfferMode(config.shopeeOfferMode); }
   catch (error) {
     logger.warn({ reason: error.message }, 'Offer sending blocked; verified flash-sale source required');
     return;
   }
   store.prune();
   let deals = [];
   if (config.shopeeAutoSearch) {
     try {
       deals = await searchShopee({ limit: config.maxDealsPerCycle,
         isAlreadySent: id => config.groups.every(group => isDealSentToGroup(id, group)) });
       logger.info({ offers: deals.length }, 'Shopee automatic search completed');
     } catch (error) {
       logger.error({ reason: error.message }, 'Shopee automatic search failed');
     }
   }
   if (config.shopeeOfferMode !== 'discount-only') try {
     const local = JSON.parse(await fs.promises.readFile(config.dealsFile, 'utf8'));
     if (!Array.isArray(local)) throw Error('Deals must be an array');
     deals.push(...local);
   } catch (error) {
     if (error.code !== 'ENOENT') throw error;
   }
   let processed = 0;
   for (const raw of deals) {
     if (stopping || processed >= config.maxDealsPerCycle) break;
     try {
       if (raw.active === false) continue;
       if (!matchesOfferFilter(raw, config.shopeeCategoryIds)) continue;
       if (!matchesSalesFilter(raw.sales, config.shopeeMinSales)) continue;
       if (raw.expiresAt && (!Number.isFinite(Date.parse(raw.expiresAt)) || Date.parse(raw.expiresAt) <= Date.now())) continue;
       // Prefer stable marketplace IDs over changing tracking URLs.
       const deal = { ...raw, id: raw.id || raw.productUrl };
       if (typeof deal.id !== 'string' || !deal.id.trim()) throw Error('Stable id or productUrl required');
       if (config.groups.every(g => isDealSentToGroup(deal.id, g))) continue;
       const link = await affiliateLink(deal);
       const caption = formatDeal({ ...deal, headline: config.offerHeadline || deal.headline }, link);
       const image = await downloadImage(deal.imageUrl);
       processed++;
       await broadcast(deal, image, caption);
     } catch (error) {
       // Do not emit URLs, affiliate secrets or remote response bodies.
       logger.error({ dealId: raw?.id, reason: error.code || error.name }, 'Deal failed; inspect input/API/media/history');
       if (['EACCES', 'ENOSPC', 'EROFS', 'EIO'].includes(error.code)) throw error;
     }
   }
 }
 function tick() {
   if (stopping || running) return;
   running = cycle().catch(() => logger.error('Cycle failed')).finally(() => { running = undefined; });
 }
 task = cron.schedule(config.interval, tick, { timezone: config.timezone, noOverlap: true });
 logger.info({ interval: config.interval, maxDealsPerCycle: config.maxDealsPerCycle, runOnStart: config.runOnStart }, 'Scheduler started');
 async function shutdown() {
   if (stopping) return; stopping = true; task.stop();
   await client.stop(); await running; release();
 }
 process.once('SIGINT', () => void shutdown()); process.once('SIGTERM', () => void shutdown());
} catch (error) {
 task?.stop(); await client?.stop(); release(); throw error;
}
