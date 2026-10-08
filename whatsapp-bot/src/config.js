import 'dotenv/config';
import cron from 'node-cron';
import path from 'node:path';
import { configuredCategories, configuredOfferMode, configuredMinSales } from './offer-filter.js';
function integer(name, fallback, min, max) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error(`Invalid ${name}`);
  return n;
}
const groups = [...new Set((process.env.GROUP_IDS ?? '').split(',').map(x => x.trim()).filter(Boolean))];
if (!groups.length || groups.some(x => !/^\d+(?:-\d+)?@g\.us$/.test(x))) throw Error('Configure valid GROUP_IDS');
const interval = process.env.CRON_INTERVAL || '* * * * *';
if (!cron.validate(interval)) throw Error('Invalid CRON_INTERVAL');
export const config = {
 dashboardEnabled: process.env.DASHBOARD_ENABLED !== 'false',
 dashboardPort: integer('DASHBOARD_PORT', 3210, 1, 65535),
 groups, interval, timezone: process.env.TIMEZONE || 'America/Sao_Paulo',
 maxDealsPerCycle: integer('MAX_DEALS_PER_CYCLE', 10000, 1, 10000),
 runOnStart: process.env.RUN_ON_START === 'true',
 shopeeAutoSearch: process.env.SHOPEE_AUTO_SEARCH !== 'false',
 shopeeOfferMode: configuredOfferMode(),
 shopeeCategoryIds: configuredCategories(),
 shopeeMinSales: configuredMinSales(),
 offerHeadline: process.env.OFFER_HEADLINE || '',
 ttlMs: integer('DEDUP_HOURS', 24, 1, 720) * 3600000,
 failedOfferCooldownMs: integer('FAILED_OFFER_COOLDOWN_MINUTES', 30, 1, 1440) * 60000,
 sendTimeoutMs: integer('SEND_TIMEOUT_SECONDS', 45, 1, 300) * 1000,
 sendIntervalMinMs: integer('SEND_INTERVAL_MIN_MINUTES', 10, 1, 1440) * 60000,
 sendIntervalMaxMs: integer('SEND_INTERVAL_MAX_MINUTES', 15, 1, 1440) * 60000,
 minMs: integer('DELAY_MIN_MS', 5000, 1000, 300000),
 maxMs: integer('DELAY_MAX_MS', 15000, 1000, 300000),
 dealsFile: path.resolve(process.env.DEALS_FILE || './deals.json'),
};
if (config.maxMs < config.minMs) throw Error('DELAY_MAX_MS must be >= DELAY_MIN_MS');
if (config.sendIntervalMaxMs < config.sendIntervalMinMs) throw Error('SEND_INTERVAL_MAX_MINUTES must be >= SEND_INTERVAL_MIN_MINUTES');
new Intl.DateTimeFormat('pt-BR', { timeZone: config.timezone });
