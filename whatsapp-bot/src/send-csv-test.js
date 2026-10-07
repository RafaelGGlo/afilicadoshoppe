import fs from 'node:fs';
import pino from 'pino';
import { setTimeout as pause } from 'node:timers/promises';
import { config } from './config.js';
import { readShopeeCsv } from './csv-offers.js';
import { formatDeal } from './format.js';
import { SentStore } from './store.js';
import { connectWhatsApp } from './whatsapp.js';

const file = process.argv[2];
if (!file) throw Error('Informe o caminho do CSV da Shopee.');
const deals = await readShopeeCsv(file);
const group = config.groups[0];
const prepared = deals.map(deal => ({ ...deal, text: '🧪 *ENVIO DE TESTE — dados do CSV da Shopee*\n\n' + formatDeal(deal, deal.affiliateUrl) + '\nPreço do arquivo, sem verificação ao vivo.' }));
console.log(`CSV validado: ${prepared.length} ofertas. Grupo de teste: ${group}.`);
if (!process.argv.includes('--send')) {
 console.log('Prévia validada. Use --send para enviar; intervalo de 60 segundos, somente texto.');
 process.exit(0);
}

const lock = './bot.lock';
const fd = fs.openSync(lock, 'wx', 0o600);
fs.writeFileSync(fd, String(process.pid));
fs.closeSync(fd);
let client;
let stopped = false;
let readyTimer;
let count = 0;
let skipped = 0;
const controller = new AbortController();
const stop = () => { stopped = true; controller.abort(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
 const store = new SentStore('./sent_deals.json', config.ttlMs);
 store.prune();
 let resolveReady;
 const ready = new Promise(resolve => { resolveReady = resolve; });
 client = await connectWhatsApp(pino({ level: 'silent' }), resolveReady);
 await Promise.race([ready, new Promise((_, reject) => {
   readyTimer = setTimeout(() => reject(Error('WhatsApp não conectou em 90 segundos.')), 90000);
 })]);
 clearTimeout(readyTimer);
 console.log('WhatsApp conectado. Iniciando envio: uma oferta por minuto.');
 let lastAttempt = 0;
 for (const deal of prepared) {
   if (stopped) break;
   if (store.isDealSentToGroup(deal.id, group)) { skipped++; continue; }
   if (lastAttempt) await pause(Math.max(0, 60000 - (Date.now() - lastAttempt)), undefined, { signal: controller.signal });
   if (stopped) break;
   const socket = client.getSocket();
   if (!socket) throw Error('Conexão perdida; lote interrompido sem repetir envios.');
   store.reserve(deal.id, group);
   lastAttempt = Date.now();
   let sendTimer;
   try {
     await Promise.race([
       socket.sendMessage(group, { text: deal.text, linkPreview: null }),
       new Promise((_, reject) => { sendTimer = setTimeout(() => reject(Error('Envio não confirmado; reserva preservada.')), 45000); }),
     ]);
   } finally { clearTimeout(sendTimer); }
   store.markDealAsSent(deal.id, group);
   count++;
   console.log(`Enviada ${count}/${prepared.length}: ${deal.id}`);
 }
 console.log(`Lote encerrado: ${count} enviadas; ${skipped} já constavam no histórico.`);
} catch (error) {
 console.error(error.name === 'AbortError' ? 'Envio interrompido.' : error.message);
 process.exitCode = 1;
} finally {
 clearTimeout(readyTimer);
 await client?.stop();
 fs.unlinkSync(lock);
}
