import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readInstagramOffers, instagramProductKey } from './instagram-catalog.js';
import { promotionalImage } from './instagram-image.js';

const defaults = { manualEnabled: true, autoEnabled: false, manualPublish: false, autoPublish: false, autoHour: 12, autoMinute: 0, autoDays: 7, autoFormat: 'feed' };
const fail = message => { throw Error(message); };
export function createInstagram({ file = path.resolve(import.meta.dirname, '../instagram.sqlite'), mediaDir = path.resolve(import.meta.dirname, '../instagram-media'), env = process.env, getOffers = readInstagramOffers, makeImage = promotionalImage, request = fetch, now = Date.now } = {}) {
 if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
 fs.mkdirSync(mediaDir, { recursive: true });
 const db = new DatabaseSync(file);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS ig_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ig_posts (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, mode TEXT NOT NULL, format TEXT NOT NULL, at TEXT NOT NULL, caption TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', snapshot TEXT NOT NULL, media TEXT NOT NULL, container_id TEXT, published_id TEXT, attempted INTEGER NOT NULL DEFAULT 0, error TEXT, tested_at TEXT);
 CREATE TABLE IF NOT EXISTS ig_publications (fingerprint TEXT PRIMARY KEY, post_id TEXT NOT NULL, state TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS ig_due ON ig_posts(status,at);`);
 db.prepare('INSERT OR IGNORE INTO ig_settings VALUES(1,?)').run(JSON.stringify(defaults));
 const settings = () => ({ ...defaults, ...JSON.parse(db.prepare('SELECT value FROM ig_settings WHERE id=1').get().value) });
 const live = () => env.INSTAGRAM_LIVE_APPROVED === 'true' && env.INSTAGRAM_TEST_MODE === 'false';
 const status = () => ({ settings: settings(), testMode: !live(), credentialsConfigured: Boolean(env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_ACCOUNT_ID && env.INSTAGRAM_API_VERSION), storiesSupported: env.INSTAGRAM_ACCOUNT_TYPE === 'BUSINESS', timezone: 'America/Sao_Paulo' });
 const get = id => db.prepare('SELECT * FROM ig_posts WHERE id=?').get(id) || fail('Agendamento não encontrado.');
 const publicPost = p => ({ ...p, snapshot: JSON.parse(p.snapshot), previewUrl: `/api/instagram/posts/${p.id}/image` });
 const list = () => db.prepare('SELECT * FROM ig_posts ORDER BY at').all().map(publicPost);
 function configure(patch) {
  const value = settings();
  for (const key of ['manualEnabled','autoEnabled','manualPublish','autoPublish']) if (key in patch) {
   if (typeof patch[key] !== 'boolean') fail('Configuração inválida.'); value[key] = patch[key];
  }
  for (const [key, max] of [['autoHour',23],['autoMinute',59],['autoDays',30]]) if (key in patch) {
   if (!Number.isInteger(patch[key]) || patch[key] < (key === 'autoDays' ? 1 : 0) || patch[key] > max) fail('Intervalo inválido.'); value[key] = patch[key];
  }
  if ('autoFormat' in patch) { if (!['feed','story'].includes(patch.autoFormat)) fail('Formato inválido.'); value.autoFormat = patch.autoFormat; }
  db.prepare('UPDATE ig_settings SET value=? WHERE id=1').run(JSON.stringify(value)); return status();
 }
 async function save(body, id = null, internal = false) {
  const old = id ? get(id) : null;
  if (old && (old.status !== 'scheduled' || old.attempted)) fail('Somente posts agendados sem tentativa podem ser editados.');
  const mode = old?.mode || (internal ? 'auto' : 'manual');
  if (!settings()[mode === 'auto' ? 'autoEnabled' : 'manualEnabled']) fail('Modo desativado.');
  const offer = getOffers().find(d => d.id === body.offerId) || fail('Selecione uma oferta disponível.');
  if (!offer.affiliateUrl && !offer.affiliate_link) fail('Esta oferta precisa de um link de afiliado existente.');
  if (!['feed', 'story'].includes(body.format)) fail('Formato inválido.');
  const at = new Date(body.at);
  if (!Number.isFinite(at.getTime()) || at.getTime() <= now() || !/Z$|[+-]\d\d:\d\d$/.test(body.at)) fail('Informe uma data futura com fuso horário.');
  if (typeof body.caption !== 'string' || !body.caption.trim() || body.caption.length > 2200) fail('Legenda obrigatória, até 2200 caracteres.');
  const imageKind = body.imageKind || 'promotional';
  if (!['promotional','product'].includes(imageKind)) fail('Imagem inválida.');
  const key = id || randomUUID(), media = randomUUID() + '.jpg';
  // Snapshot and immutable JPEG isolate publishing from later product/database changes.
  const image = await makeImage(offer, body.format, null, imageKind);
  fs.writeFileSync(path.join(mediaDir, media), image, { mode: 0o600 });
  const snapshot = JSON.stringify({ id: offer.id, productKey: instagramProductKey(offer), title: offer.title, price: offer.price, previousPrice: offer.previousPrice, discountRate: offer.discountRate, affiliateUrl: offer.affiliateUrl || offer.affiliate_link, testOnly: offer.testOnly === true, imageKind });
  if (id) {
   const result = db.prepare("UPDATE ig_posts SET offer_id=?,format=?,at=?,caption=?,snapshot=?,media=?,tested_at=NULL WHERE id=? AND status='scheduled' AND attempted=0").run(offer.id, body.format, at.toISOString(), body.caption.trim(), snapshot, media, id);
   if (!result.changes) fail('O post já está em processamento.');
  } else db.prepare('INSERT INTO ig_posts(id,offer_id,mode,format,at,caption,snapshot,media) VALUES(?,?,?,?,?,?,?,?)').run(key, offer.id, mode, body.format, at.toISOString(), body.caption.trim(), snapshot, media);
  return publicPost(get(key));
 }
 function cancel(id) {
  const result = db.prepare("UPDATE ig_posts SET status='cancelled' WHERE id=? AND status IN ('scheduled','failed') AND attempted=0").run(id);
  if (!result.changes) fail('Post inexistente, finalizado ou com tentativa em andamento.');
  return publicPost(get(id));
 }
 function test(id) {
  const p = get(id); if (!fs.existsSync(path.join(mediaDir, p.media))) fail('Imagem ausente.');
  db.prepare('UPDATE ig_posts SET tested_at=? WHERE id=?').run(new Date(now()).toISOString(), id);
  return { ok: true, published: false, message: 'Prévia validada localmente. Nenhuma chamada à Meta foi realizada.', post: publicPost(get(id)) };
 }
 async function graph(resource, method = 'GET', data) {
  const host = env.INSTAGRAM_LOGIN_TYPE === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
  if (!/^v\d+\.0$/.test(env.INSTAGRAM_API_VERSION || '') || !/^\d+$/.test(env.INSTAGRAM_ACCOUNT_ID || '')) fail('Configure a versão da API e o ID da conta.');
  const response = await request(`https://${host}/${env.INSTAGRAM_API_VERSION}/${resource}`, {
   method, headers: { Authorization: 'Bearer ' + env.INSTAGRAM_ACCESS_TOKEN, ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
   body: data ? new URLSearchParams(data) : undefined, redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  // Never return Meta error messages (they may echo tokens or sensitive URLs).
  if (!response.ok || body.error) fail(`Meta rejeitou a operação (HTTP ${response.status}, código ${Number(body.error?.code) || 0}).`);
  return body;
 }
 function publicBase() {
  const base = new URL(env.INSTAGRAM_PUBLIC_BASE_URL || '');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || ['localhost','127.0.0.1','::1','[::1]'].includes(base.hostname)) fail('Configure uma URL HTTPS pública para a mídia.');
  return base.href.replace(/\/$/, '');
 }
 async function publish(id) {
  let p = get(id);
  if (!live()) fail('Publicação bloqueada: modo de teste ou aprovação inicial ausente.');
  const s = settings();
  if (!s[p.mode === 'auto' ? 'autoEnabled' : 'manualEnabled'] || !s[p.mode === 'auto' ? 'autoPublish' : 'manualPublish']) fail('Publicação deste modo desativada.');
  if (!status().credentialsConfigured) fail('Credenciais Meta ausentes.');
  if (p.format === 'story' && !status().storiesSupported) fail('Stories exigem conta Business compatível.');
  if (JSON.parse(p.snapshot).testOnly) fail('Oferta de teste não pode ser publicada.');
  if (p.status !== 'scheduled' || p.attempted || Date.parse(p.at) > now()) fail('Post não está disponível para publicação.');
  const imageUrl = publicBase() + '/instagram-media/' + p.media;
  const fingerprint = createHash('sha256').update(`${env.INSTAGRAM_ACCOUNT_ID}|${JSON.parse(p.snapshot).productKey || p.offer_id}|${p.format}`).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
   const reserved = db.prepare("UPDATE ig_posts SET attempted=1 WHERE id=? AND attempted=0 AND status='scheduled'").run(id);
   if (!reserved.changes) fail('Publicação já reservada.');
   db.prepare("INSERT INTO ig_publications VALUES(?,?,'reserved')").run(fingerprint, id);
   db.exec('COMMIT');
  } catch { db.exec('ROLLBACK'); db.prepare("UPDATE ig_posts SET status='failed',error='Oferta já reservada ou publicada; duplicação bloqueada.' WHERE id=? AND attempted=0").run(id); fail('Duplicação bloqueada.'); }
  try {
   const container = await graph(env.INSTAGRAM_ACCOUNT_ID + '/media', 'POST', { image_url: imageUrl, ...(p.format === 'story' ? { media_type: 'STORIES' } : { caption: p.caption }) });
   if (!/^\d+$/.test(String(container.id))) fail('Resposta Meta inválida.');
   db.prepare('UPDATE ig_posts SET container_id=? WHERE id=?').run(String(container.id), id);
   let ready;
   for (let attempt = 0; attempt < 10; attempt++) {
    ready = await graph(container.id + '?fields=status_code');
    if (ready.status_code !== 'IN_PROGRESS') break;
    await new Promise(resolve => setTimeout(resolve, 2000));
   }
   if (ready.status_code !== 'FINISHED') fail('Mídia ainda não está pronta. Verifique o container na Meta antes de reconciliar.');
   const published = await graph(env.INSTAGRAM_ACCOUNT_ID + '/media_publish', 'POST', { creation_id: container.id });
   if (!/^\d+$/.test(String(published.id))) fail('Confirmação Meta inválida.');
   db.prepare("UPDATE ig_posts SET status='published',published_id=?,error=NULL WHERE id=?").run(String(published.id), id);
   db.prepare("UPDATE ig_publications SET state='published' WHERE fingerprint=?").run(fingerprint);
  } catch (error) {
   db.prepare("UPDATE ig_posts SET status='failed',error=? WHERE id=?").run(error.message.startsWith('Meta ') ? error.message : 'Resultado incerto ou mídia não pronta. Reserva mantida; verificar na Meta antes de qualquer nova tentativa.', id);
  }
  return publicPost(get(id));
 }
 let autoBusy = false;
 async function autoSchedule() {
  if (autoBusy) return { created: [] }; autoBusy = true;
  try { return await fillAuto(); } finally { autoBusy = false; }
 }
 async function fillAuto() {
  const s = settings(); if (!s.autoEnabled) fail('Agendamento automático desativado.');
  const offers = getOffers().filter(o => o.affiliateUrl && !o.testOnly);
  const created = [];
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now()));
  let cursor = new Date(day + 'T12:00:00-03:00');
  for (let i = 0; i < s.autoDays; i++, cursor.setUTCDate(cursor.getUTCDate() + 1)) {
   const date = cursor.toISOString().slice(0,10), at = `${date}T${String(s.autoHour).padStart(2,'0')}:${String(s.autoMinute).padStart(2,'0')}:00-03:00`;
   if (Date.parse(at) <= now() || db.prepare("SELECT 1 FROM ig_posts WHERE mode='auto' AND at=? AND status!='cancelled'").get(new Date(at).toISOString())) continue;
   const offer = offers.find(o => !db.prepare("SELECT 1 FROM ig_posts WHERE offer_id=? AND format=? AND status!='cancelled'").get(o.id, s.autoFormat));
   if (!offer) break;
   created.push(await save({ offerId: offer.id, format: s.autoFormat, at, caption: `${offer.title}\n${Number(offer.price).toLocaleString('pt-BR',{ style:'currency', currency:'BRL' })}\n${offer.affiliateUrl}\n#ofertas #afiliado` }, null, true));
  }
  return { created };
 }
 let busy = false, closed = false;
 async function tick() {
  if (busy || closed) return; busy = true;
  try {
   if (settings().autoEnabled) await autoSchedule();
   if (live()) for (const p of db.prepare("SELECT id FROM ig_posts WHERE status='scheduled' AND attempted=0 AND at<=? ORDER BY at LIMIT 10").all(new Date(now()).toISOString())) {
    try { await publish(p.id); } catch { /* gate or duplicate: no external call */ }
   }
  } finally { busy = false; }
 }
 // A process interruption after reservation must never cause a blind retry.
 db.prepare("UPDATE ig_posts SET status='failed',error='Processo interrompido após reserva. Verifique na Meta; repetição bloqueada.' WHERE attempted=1 AND status='scheduled'").run();
 const timer = setInterval(() => { void tick().catch(() => {}); }, 30000); timer.unref();
 return { status, configure, list, save, cancel, test, publish, autoSchedule, tick, get, offers: () => getOffers().map(({ imageFile, ...o }) => o),
  image: id => fs.readFileSync(path.join(mediaDir, get(id).media)),
  publicImage: name => { if (!live() || !/^[a-f0-9-]{36}\.jpg$/.test(name) || !db.prepare('SELECT 1 FROM ig_posts WHERE media=? AND attempted=1').get(name)) fail('Mídia indisponível.'); return fs.readFileSync(path.join(mediaDir, name)); },
  async close() { closed = true; clearInterval(timer); while (busy || autoBusy) await new Promise(resolve => setTimeout(resolve, 20)); db.close(); },
 };
}
