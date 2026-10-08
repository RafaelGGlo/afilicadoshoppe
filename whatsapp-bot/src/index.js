import fs from 'node:fs';
import cron from 'node-cron';
import pino from 'pino';
import { config } from './config.js';
import { SentStore } from './store.js';
import { OfferCooldown, prepareOffer } from './offer-preparation.js';
import { SendPacing } from './send-pacing.js';
import { createBroadcaster } from './broadcast.js';
import { connectWhatsApp } from './whatsapp.js';
import { createShopeeSource } from './shopee-offers.js';
import { matchesOfferFilter, assertSupportedOfferMode, matchesSalesFilter } from './offer-filter.js';
import { BotReport } from './report.js';
import { startDashboard } from './dashboard-server.js';
import { matchesOfferFilters, DEFAULT_OFFER_FILTERS } from '../dashboard/filters.js';
import { snapshotOfferFilters } from './search-snapshot.js';
import { requestBotStop } from './dashboard-stop.js';
import { BotControl } from './control.js';
import { acquireLock } from './bot-lock.js';

const logger = pino({ level: 'info' });
const lock = './bot.lock';
const owner = acquireLock(lock);
let client, task, running, report, dashboard, heartbeat, stopping = false, initialized = false;
function release() { owner.release(); }
try {
 const store = new SentStore('./sent_deals.json', config.ttlMs);
 const isDealSentToGroup = (id, group) => store.isDealSentToGroup(id, group);
 let searchShopee = createShopeeSource(), sourceFilterKey = null;
 const cooldown = new OfferCooldown('./failed_deals.json', config.failedOfferCooldownMs);
 const control = new BotControl('./bot_control.json', { minMinutes: config.sendIntervalMinMs / 60000, maxMinutes: config.sendIntervalMaxMs / 60000, offerFilters: { ...DEFAULT_OFFER_FILTERS, minSales: config.shopeeMinSales, categories: config.shopeeCategoryIds } });
 const pacing = new SendPacing('./send_schedule.json', { minMs: control.data.minMinutes * 60000, maxMs: control.data.maxMinutes * 60000 });
 report = new BotReport('./bot_report.json', { settings: { searchInterval: config.interval,
  sendMinMinutes: config.sendIntervalMinMs / 60000, sendMaxMinutes: config.sendIntervalMaxMs / 60000,
  dedupHours: config.ttlMs / 3600000, minSales: config.shopeeMinSales, allCategories: config.shopeeCategoryIds.length === 0,
  timezone: config.timezone, groupCount: config.groups.length }, onError: () => logger.warn('Could not save dashboard report') });
 const due = pacing.canSend.bind(pacing);
 pacing.canSend = () => !stopping && !control.data.paused && due();
 function syncControl() {
  const data = control.reload();
  const key = JSON.stringify({ categories: data.offerFilters.categories, minSales: data.offerFilters.minSales });
  if (sourceFilterKey !== key) { searchShopee = createShopeeSource({ env: { ...process.env, SHOPEE_CATEGORY_IDS: data.offerFilters.categories.join(','), SHOPEE_MIN_SALES: String(data.offerFilters.minSales) }, randomize: data.offerFilters.categories.length === 0 }); sourceFilterKey = key; }
  pacing.configure(data.minMinutes * 60000, data.maxMinutes * 60000);
  report.data.control = { paused: data.paused, minMinutes: data.minMinutes, maxMinutes: data.maxMinutes, offerFilters: data.offerFilters };
  report.data.settings.allCategories = data.offerFilters.categories.length === 0; report.data.settings.minSales = data.offerFilters.minSales;
  report.data.settings.sendMinMinutes = data.minMinutes; report.data.settings.sendMaxMinutes = data.maxMinutes;
  report.data.nextSearchAt = task?.getNextRun()?.getTime() ?? null;
  report.heartbeat(pacing.nextAllowedAt);
  if (data.stopToken === owner.token && initialized) void shutdown();
 }
 syncControl();
 heartbeat = setInterval(() => { try { syncControl(); } catch { control.data.paused = true; report.state('control_error'); logger.error('Control update failed; new sends paused'); } }, 1000);
 if (config.dashboardEnabled) {
  try { dashboard = await startDashboard({ port: config.dashboardPort, getReport: () => ({ ...report.snapshot(), botRunning: !stopping, botStopping: stopping }), onStop: () => requestBotStop({ lockFile: lock, control }), onControl: patch => { const data = control.update(patch); syncControl(); return { paused: data.paused, minMinutes: data.minMinutes, maxMinutes: data.maxMinutes }; } }); logger.info({ url: dashboard.url }, 'Painel de relatórios disponível'); }
  catch (error) { logger.warn({ reason: error.code || error.name, port: config.dashboardPort }, 'Dashboard unavailable; bot will continue'); }
 }
 let startupPending = config.runOnStart;
 client = await connectWhatsApp(logger, () => {
   if (startupPending && initialized) { startupPending = false; tick(); }
 }, state => report.connection(state));
 const broadcast = createBroadcaster({ store, ...config, pacing, getSocket: client.getSocket, logger, onResult: result => report.event(result) });
 async function cycle() {
   if (!client.getSocket()) { report.state('disconnected', pacing.nextAllowedAt); return; }
   syncControl();
   if (stopping) return;
   const cycleFilters = snapshotOfferFilters(control.data.offerFilters), cycleSource = searchShopee;
   report.beginCycle();
   report.data.activeSearchCategories = [...cycleFilters.categories];
   let outcome = 'idle';
   try {
    try { assertSupportedOfferMode(config.shopeeOfferMode); }
    catch (error) { outcome = 'blocked'; logger.warn({ reason: error.message }, 'Offer sending blocked; verified flash-sale source required'); return; }
    store.prune(); cooldown.prune();
    let deals = [];
    if (config.shopeeAutoSearch) {
     try {
      deals = await cycleSource({ limit: config.maxDealsPerCycle, isDeferred: id => cooldown.isDeferred(id),
       isAlreadySent: id => config.groups.every(group => isDealSentToGroup(id, group)), onSearchSummary: stats => report.search(stats), matchesExtraFilters: deal => matchesOfferFilters(deal, cycleFilters) });
      report.data.lastError = null;
      logger.info({ offers: deals.length }, 'Shopee automatic search completed');
     } catch (error) { outcome = 'error'; report.data.lastError = error.code || 'SHOPEE_QUERY'; logger.error({ reason: error.code || error.name }, 'Shopee automatic search failed'); }
    }
    if (config.shopeeOfferMode !== 'discount-only') try {
     const local = JSON.parse(await fs.promises.readFile(config.dealsFile, 'utf8'));
     if (!Array.isArray(local)) throw Error('Deals must be an array');
     deals.push(...local); report.search({ consulted: local.length, evaluated: local.length });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    report.data.latestOffers = deals.slice(0, 5).map(deal => ({ title: String(deal.title || '').slice(0,300), price: Number.isFinite(deal.price) ? deal.price : null }));
    if (!pacing.canSend()) { if (outcome !== 'error') outcome = control.data.paused ? 'paused' : 'waiting'; return; }
    if (!deals.length) { if (outcome !== 'error') outcome = 'no_offers'; return; }
    let processed = 0;
    for (const raw of deals) {
     if (stopping || processed >= config.maxDealsPerCycle || !pacing.canSend()) break;
     try {
      if (raw.active === false) continue;
      if (!matchesOfferFilter(raw, cycleFilters.categories) || !matchesOfferFilters(raw, cycleFilters)) continue;
      if (!matchesSalesFilter(raw.sales, cycleFilters.minSales)) continue;
      if (raw.expiresAt && (!Number.isFinite(Date.parse(raw.expiresAt)) || Date.parse(raw.expiresAt) <= Date.now())) continue;
      const deal = { ...raw, id: raw.id || raw.productUrl };
      if (typeof deal.id !== 'string' || !deal.id.trim()) throw Error('Stable id or productUrl required');
      if (cooldown.isDeferred(deal.id)) continue;
      if (config.groups.every(group => isDealSentToGroup(deal.id, group))) continue;
      const { image, caption } = await prepareOffer(deal, { cooldown, headline: config.offerHeadline || deal.headline });
      processed++; report.state('sending', pacing.nextAllowedAt);
      await broadcast(deal, image, caption);
      outcome = pacing.canSend() ? 'idle' : 'waiting';
     } catch (error) {
      report.event({ type: 'preparation_failed', title: raw?.title, price: raw?.price, dealId: raw?.id });
      outcome = 'error'; logger.error({ dealId: raw?.id, reason: error.code || error.name }, 'Deal failed; inspect input/API/media/history');
      if (['EACCES', 'ENOSPC', 'EROFS', 'EIO'].includes(error.code)) throw error;
     }
    }
   } catch (error) { outcome = 'error'; throw error; }
   finally {
    report.finishCycle({ status: stopping ? 'stopped' : outcome, nextSendAt: pacing.nextAllowedAt });
    logger.info({ ...report.snapshot().lastCycle, nextSendAt: pacing.nextAllowedAt }, 'Resumo do ciclo');
   }
 }
 function tick() {
   if (stopping || running) return;
   running = cycle().catch(() => logger.error('Cycle failed')).finally(() => { running = undefined; });
 }
 task = cron.schedule(config.interval, tick, { timezone: config.timezone, noOverlap: true });
 initialized = true; syncControl();
 if (startupPending && client.getSocket()) { startupPending = false; tick(); }
 logger.info({ interval: config.interval, maxDealsPerCycle: config.maxDealsPerCycle, runOnStart: config.runOnStart }, 'Scheduler started');
 async function shutdown() {
   if (stopping) return;
   stopping = true; report.state('stopping'); task?.stop(); clearInterval(heartbeat);
   await client.stop(); await running; report.stop(); await dashboard?.stop(); release();
 }
 process.once('SIGINT', () => void shutdown()); process.once('SIGTERM', () => void shutdown());
} catch (error) {
 task?.stop(); clearInterval(heartbeat); await client?.stop(); report?.stop(); await dashboard?.stop(); release(); throw error;
}
