const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');
const dbm = require('./db');
const { ShopeeClient } = require('./shopee');
const offers = require('./offers');
const manual = require('./manual');
const auth = require('./auth');
const { createRunner } = require('./scheduler');

function isLoopback(host) {
  return ['127.0.0.1', 'localhost', '::1'].includes(host);
}

// Valida e limpa as configurações recebidas do painel.
function sanitizeSettings(b = {}) {
  const num = (v, min, max, def) => Math.min(Math.max(Number.isFinite(Number(v)) ? Number(v) : def, min), max);
  const list = v => (Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/)).map(s => String(s).trim()).filter(Boolean).slice(0, 30);
  const price = v => (v === '' || v == null ? '' : num(v, 0, 1e7, 0));
  const patch = {};
  if ('keywords' in b) patch.keywords = list(b.keywords);
  if ('categoryIds' in b) patch.categoryIds = list(b.categoryIds).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if ('priceMin' in b) patch.priceMin = price(b.priceMin);
  if ('priceMax' in b) patch.priceMax = price(b.priceMax);
  if ('sortType' in b) patch.sortType = Math.round(num(b.sortType, 1, 5, 5));
  if ('pagesPerQuery' in b) patch.pagesPerQuery = Math.round(num(b.pagesPerQuery, 1, 5, 1));
  if ('pageSize' in b) patch.pageSize = Math.round(num(b.pageSize, 1, 50, 20));
  if ('dedupeDays' in b) patch.dedupeDays = Math.round(num(b.dedupeDays, 0, 365, 14));
  if ('maxPerRun' in b) patch.maxPerRun = Math.round(num(b.maxPerRun, 1, 50, 10));
  if ('autoEnabled' in b) patch.autoEnabled = !!b.autoEnabled;
  if ('autoEveryMinutes' in b) patch.autoEveryMinutes = Math.round(num(b.autoEveryMinutes, 15, 10080, 180));
  if ('subIds' in b) patch.subIds = list(b.subIds).slice(0, 5);
  if ('template' in b) {
    const t = String(b.template ?? '').slice(0, 2000);
    if (!t.includes('{link}')) throw new Error('O modelo precisa conter {link}.');
    patch.template = t;
  }
  return patch;
}

// Não devolve caminhos internos; só o necessário para o painel.
function publicOffer(o) {
  if (!o) return o;
  return {
    id: o.id, itemId: o.item_id, name: o.name, priceMin: o.price_min, priceMax: o.price_max,
    productLink: o.product_link, affiliateLink: o.affiliate_link,
    imageUrl: o.image_file ? `/imagens/${o.image_file}` : null, imageStatus: o.image_status, imageNote: o.image_note,
    caption: o.caption, status: o.status, reviewReason: o.review_reason, source: o.source,
    previousPrice: o.previous_price, coupon: o.coupon, couponConditions: o.coupon_conditions,
    observations: o.observations, category: o.category,
    sameVariant: o.previous_same_variant === 1,
    keyword: o.keyword, fetchedAt: o.fetched_at, createdAt: o.created_at, updatedAt: o.updated_at,
  };
}

function createApp({ cfg = config.load(), db, client } = {}) {
  db = db || dbm.open(cfg.dbFile);
  fs.mkdirSync(cfg.imagesDir, { recursive: true });
  if (client === undefined) {
    client = cfg.demoMode ? null : new ShopeeClient({ appId: cfg.appId, secret: cfg.secret, endpoint: cfg.endpoint });
  }
  const runner = createRunner({ db, runSearch: ({ keyword, trigger }) => offers.runSearch({ db, client, cfg, keyword, trigger }) });
  const limiter = auth.createLoginLimiter();
  const needsLogin = !!cfg.panelPassword;

  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  // Upload codificado em base64: limite maior apenas nas rotas de cadastro manual.
  app.use('/api/manual', express.json({ limit: '9mb' }));
  app.use(express.json({ limit: '100kb' }));

  // CSRF: ações que alteram dados exigem este cabeçalho (o cookie também é SameSite=Strict).
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'painel') {
      return res.status(403).json({ error: 'Requisição não permitida.' });
    }
    next();
  });

  const isLogged = req => !needsLogin || auth.tokenValid(cfg.sessionSecret, auth.parseCookies(req.headers.cookie)[auth.COOKIE]);
  const wrap = fn => (req, res) => Promise.resolve()
    .then(() => fn(req, res))
    .then(result => { if (!res.headersSent && result !== undefined) res.json(result); })
    .catch(err => { if (!res.headersSent) res.status(err.status || 400).json({ error: err.message || 'Erro.' }); });

  app.get('/api/session', (req, res) => res.json({ needsLogin, logged: isLogged(req) }));

  app.post('/api/login', (req, res) => {
    if (!needsLogin) return res.json({ ok: true });
    const ip = req.ip;
    if (!limiter.check(ip)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    if (!auth.passwordMatches(req.body?.password ?? '', cfg.panelPassword)) {
      limiter.fail(ip);
      return res.status(401).json({ error: 'Senha incorreta.' });
    }
    limiter.reset(ip);
    const secure = req.secure ? '; Secure' : '';
    res.set('Set-Cookie', `${auth.COOKIE}=${auth.makeToken(cfg.sessionSecret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${auth.MAX_AGE_MS / 1000}${secure}`);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.set('Set-Cookie', `${auth.COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  // ---- tudo abaixo exige login (quando há senha) ----
  app.use('/api', (req, res, next) => (isLogged(req) ? next() : res.status(401).json({ error: 'Faça login.' })));
  app.use('/imagens', (req, res, next) => (isLogged(req) ? next() : res.status(401).end()));
  app.use('/imagens', express.static(cfg.imagesDir, { maxAge: '1h', index: false }));

  app.get('/api/status', (req, res) => res.json({
    demoMode: !client,
    running: runner.isRunning(),
    lastAutoRunAt: dbm.getSettings(db).lastAutoRunAt,
  }));

  app.get('/api/settings', (req, res) => res.json(dbm.getSettings(db)));
  app.put('/api/settings', wrap(req => {
    dbm.saveSettings(db, sanitizeSettings(req.body));
    return dbm.getSettings(db);
  }));

  // Consulta manual (usa as configurações; "keyword" opcional substitui as palavras-chave salvas)
  app.post('/api/search', wrap(async req => {
    const keyword = String(req.body?.keyword ?? '').trim().slice(0, 80) || null;
    const summary = await runner.run('manual', keyword);
    if (summary.busy) throw Object.assign(new Error('Já existe uma consulta em andamento. Aguarde terminar.'), { status: 409 });
    return summary;
  }));

  app.get('/api/offers', wrap(req => ({
    offers: offers.listOffers(db, { status: req.query.status, q: req.query.q }).map(publicOffer),
  })));

  app.post('/api/manual', wrap(async req => publicOffer(await manual.saveManual({ db, cfg, body: req.body }))));
  app.put('/api/manual/:id', wrap(async req => publicOffer(await manual.saveManual({ db, cfg, body: req.body, id: req.params.id }))));
  app.post('/api/offers/:id/duplicate', wrap(req => publicOffer(manual.duplicateOffer(db, req.params.id))));

  app.get('/api/offers/:id', wrap(req => {
    const o = offers.getOffer(db, req.params.id);
    if (!o) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 });
    return publicOffer(o);
  }));

  // Atualiza os dados na Shopee antes da publicação final e regenera a legenda.
  app.post('/api/offers/:id/finalize', wrap(async req => {
    const r = await offers.refreshOffer({ db, client, cfg, id: req.params.id });
    return { offer: publicOffer(r.offer), refreshed: r.refreshed, note: r.note };
  }));

  app.patch('/api/offers/:id', wrap(req => {
    const id = req.params.id;
    if (!offers.getOffer(db, id)) throw Object.assign(new Error('Oferta não encontrada.'), { status: 404 });
    if (typeof req.body?.caption === 'string') offers.setCaption(db, id, req.body.caption);
    if (typeof req.body?.status === 'string') offers.setStatus(db, id, req.body.status);
    return publicOffer(offers.getOffer(db, id));
  }));

  app.post('/api/offers/:id/caption/reset', wrap(req => publicOffer(offers.resetCaption(db, req.params.id))));

  // Envio manual de imagem: o corpo é o arquivo (JPG, PNG ou WebP) — validado pelo conteúdo real.
  app.post('/api/offers/:id/image', express.raw({ type: () => true, limit: '6mb' }), wrap(async req => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new Error('Nenhum arquivo recebido.');
    const o = await offers.attachManualImage({ db, cfg, id: req.params.id, buffer: req.body });
    return publicOffer(o);
  }));

  app.get('/api/history', wrap(req => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = db.prepare('SELECT id, at, kind, mode, message FROM history ORDER BY id DESC LIMIT ?').all(limit);
    return { history: rows };
  }));

  // Painel (HTML/CSS/JS). O JS não contém nenhuma credencial.
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  // Erros de upload grande etc.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const tooBig = err.type === 'entity.too.large';
    res.status(tooBig ? 413 : err.status || 500).json({ error: tooBig ? 'Arquivo grande demais.' : 'Erro interno.' });
  });

  return { app, db, runner, client, cfg };
}

function start() {
  const cfg = config.load();
  if (!isLoopback(cfg.host) && !cfg.panelPassword) {
    console.error('ERRO: para abrir o painel fora deste computador (HOST diferente de 127.0.0.1) defina PANEL_PASSWORD no .env.');
    process.exit(1);
  }
  if (cfg.panelPassword && cfg.sessionSecret === 'dev-only-secret-change-me') {
    console.warn('AVISO: defina SESSION_SECRET no .env com um texto aleatório longo.');
  }
  const { app, runner } = createApp({ cfg });
  app.listen(cfg.port, cfg.host, () => {
    console.log(`Painel em http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`);
    console.log(cfg.demoMode
      ? 'MODO DEMONSTRAÇÃO: sem SHOPEE_APP_ID/SHOPEE_SECRET, os dados são simulados.'
      : 'Modo real: usando a API de afiliados da Shopee.');
  });
  runner.start();
}

if (require.main === module) start();

module.exports = { createApp, isLoopback, sanitizeSettings, publicOffer };
