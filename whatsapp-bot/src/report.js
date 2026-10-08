import fs from 'node:fs';
import path from 'node:path';

export const searchCounters = () => ({ pages: 0, consulted: 0, evaluated: 0, valid: 0, alreadySent: 0, cooldown: 0, noDiscount: 0, lowSales: 0, invalid: 0, filtered: 0, duplicate: 0, apiErrors: 0 });
const cycleCounters = () => ({ ...searchCounters(), attempted: 0, sent: 0, sendFailures: 0, preparationFailures: 0 });
export function emptyReport(now = Date.now()) {
 return { version: 1, startedAt: null, updatedAt: now, heartbeatAt: null, connection: 'offline', status: 'not_started', nextSendAt: null,
  settings: {}, totals: { cycles: 0, ...cycleCounters() }, lastCycle: null, cycles: [], activity: [] };
}
export function readReport(file) {
 if (!fs.existsSync(file)) return emptyReport();
 const report = JSON.parse(fs.readFileSync(file, 'utf8'));
 if (report.version !== 1 || !Array.isArray(report.activity) || !Array.isArray(report.cycles) || !report.totals || Object.keys(cycleCounters()).some(key => !Number.isSafeInteger(report.totals[key]) || report.totals[key] < 0)) throw Error('Invalid report file');
 return report;
}
export class BotReport {
 constructor(file, { now = Date.now, settings = {}, onError = () => {} } = {}) {
  this.file = path.resolve(file); this.now = now; this.onError = onError; this.cycle = null;
  try { this.data = readReport(this.file); } catch { this.data = emptyReport(now()); }
  this.data.startedAt = now(); this.data.heartbeatAt = now(); this.data.connection = 'connecting'; this.data.status = 'starting';
  // Explicit allowlist: never persist environment credentials or WhatsApp session data.
  this.data.settings = { searchInterval: settings.searchInterval || '* * * * *', sendMinMinutes: settings.sendMinMinutes ?? 10,
   sendMaxMinutes: settings.sendMaxMinutes ?? 15, dedupHours: settings.dedupHours ?? 24, minSales: settings.minSales ?? 0,
   allCategories: settings.allCategories !== false, groupCount: Number.isSafeInteger(settings.groupCount) ? settings.groupCount : 0, timezone: settings.timezone || 'America/Sao_Paulo' };
  this.flush();
 }
 flush() {
  this.data.updatedAt = this.now();
  try {
   fs.mkdirSync(path.dirname(this.file), { recursive: true });
   const temporary = this.file + '.tmp';
   const fd = fs.openSync(temporary, 'w', 0o600);
   try { fs.writeFileSync(fd, JSON.stringify(this.data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
   fs.renameSync(temporary, this.file);
  } catch { this.onError(); }
 }
 heartbeat(nextSendAt) { this.data.heartbeatAt = this.now(); if (nextSendAt !== undefined) this.data.nextSendAt = nextSendAt; this.flush(); }
 connection(status) { this.data.connection = status; this.heartbeat(); }
 beginCycle() {
  this.cycle = { startedAt: this.now(), finishedAt: null, status: 'searching', ...cycleCounters() };
  this.data.status = 'searching'; this.flush();
 }
 search(stats) {
  if (!this.cycle) return;
  for (const key of Object.keys(searchCounters())) if (Number.isSafeInteger(stats[key]) && stats[key] >= 0) this.cycle[key] += stats[key];
 }
 state(status, nextSendAt) { this.data.status = status; if (nextSendAt !== undefined) this.data.nextSendAt = nextSendAt; this.flush(); }
 event(event) {
  const type = ['sent', 'send_failed', 'preparation_failed'].includes(event.type) ? event.type : 'preparation_failed';
  if (this.cycle) {
   if (type === 'sent') { this.cycle.attempted++; this.cycle.sent++; }
   else if (type === 'send_failed') { this.cycle.attempted++; this.cycle.sendFailures++; }
   else this.cycle.preparationFailures++;
  }
  this.data.activity.unshift({ at: this.now(), type, title: String(event.title || 'Oferta sem título').slice(0, 300),
   dealId: String(event.dealId || '').slice(0, 160), price: Number.isFinite(event.price) ? event.price : null,
   group: Number.isSafeInteger(event.group) ? event.group : null,
   reason: type === 'sent' ? null : event.reason === 'SEND_TIMEOUT' ? 'SEND_TIMEOUT' : type === 'send_failed' ? 'SEND_FAILURE' : 'PREPARATION_FAILURE' });
  this.data.activity = this.data.activity.slice(0, 200); this.flush();
 }
 finishCycle({ status = 'idle', nextSendAt } = {}) {
  if (!this.cycle) return;
  const summary = { ...this.cycle, status, finishedAt: this.now() };
  this.data.lastCycle = summary; this.data.cycles.unshift(summary); this.data.cycles = this.data.cycles.slice(0, 60);
  this.data.totals.cycles++;
  for (const key of Object.keys(cycleCounters())) this.data.totals[key] += summary[key];
  this.cycle = null; this.data.status = status;
  this.heartbeat(nextSendAt);
 }
 stop() { this.data.connection = 'offline'; this.data.status = 'stopped'; this.heartbeat(); }
 snapshot() { return JSON.parse(JSON.stringify({ ...this.data, currentCycle: this.cycle })); }
}
