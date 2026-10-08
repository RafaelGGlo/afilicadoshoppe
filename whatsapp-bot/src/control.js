import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_OFFER_FILTERS, validateOfferFilters } from '../dashboard/filters.js';
export class BotControl {
 constructor(file, { minMinutes = 10, maxMinutes = 15, offerFilters = DEFAULT_OFFER_FILTERS } = {}) {
  this.file = path.resolve(file);
  this.defaults = { paused: false, minMinutes, maxMinutes, stopToken: null, offerFilters: validateOfferFilters(offerFilters) };
  this.data = this.read();
 }
 read() {
  const data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { ...this.defaults };
  data.offerFilters = validateOfferFilters(data.offerFilters === undefined ? this.defaults.offerFilters : data.offerFilters);
  this.validate(data); return data;
 }
 validate(data) {
  validateOfferFilters(data.offerFilters);
  if (typeof data.paused !== 'boolean' || !Number.isSafeInteger(data.minMinutes) || !Number.isSafeInteger(data.maxMinutes) || data.minMinutes < 1 || data.maxMinutes < data.minMinutes || data.maxMinutes > 1440 || (data.stopToken != null && typeof data.stopToken !== 'string')) throw Error('Configuração de controle inválida. Use intervalos entre 1 e 1440 minutos.');
 }
 reload() { this.data = this.read(); return { ...this.data }; }
 update(patch) {
  if (Object.keys(patch).some(key => !['paused','minMinutes','maxMinutes','offerFilters'].includes(key))) throw Error('Comando de controle inválido.');
  const next = { ...this.read(), ...patch }; next.offerFilters = validateOfferFilters(next.offerFilters); this.validate(next); this.write(next); return { ...next };
 }
 requestStop(token) { const next = { ...this.read(), stopToken: token }; this.write(next); }
 write(data) {
  fs.mkdirSync(path.dirname(this.file), { recursive: true });
  const temporary = this.file + '.tmp'; const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, this.file); this.data = data;
 }
}
