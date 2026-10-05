const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const LEGACY_TEMPLATE = `🔥 Oferta Shopee!
{nome}
💰 {preco}
🛒 Compre aqui: {link}

Preço e disponibilidade podem mudar.
Link de afiliado: posso receber comissão pela compra.`;

const DEFAULT_TEMPLATE = `🔥 OFERTA SHOPEE!
{nome}
💰 {preco}
{desconto}
{extras}
🛒 Compre aqui: {link}`;

const DEFAULT_SETTINGS = {
  keywords: ['fone bluetooth', 'carregador turbo'],
  categoryIds: [],
  priceMin: '',
  priceMax: '',
  sortType: 5,
  pagesPerQuery: 1,
  pageSize: 20,
  dedupeDays: 14,
  maxPerRun: 10,
  autoEnabled: false,
  autoEveryMinutes: 180,
  template: DEFAULT_TEMPLATE,
  subIds: ['painel'],
  lastAutoRunAt: null,
};

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL,
      shop_id TEXT,
      name TEXT NOT NULL,
      price_min REAL, price_max REAL,
      product_link TEXT, affiliate_link TEXT,
      api_image_url TEXT, image_file TEXT,
      image_status TEXT NOT NULL DEFAULT 'none',
      image_note TEXT,
      caption TEXT,
      status TEXT NOT NULL DEFAULT 'preparada',
      review_reason TEXT,
      source TEXT NOT NULL DEFAULT 'api',
      keyword TEXT,
      fetched_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_offers_item ON offers(item_id);
    CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      mode TEXT,
      message TEXT NOT NULL,
      details TEXT
    );
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(offers)').all().map(c => c.name));
  for (const [name, type] of Object.entries({ previous_price: 'REAL', previous_same_variant: 'INTEGER NOT NULL DEFAULT 0', coupon: 'TEXT', coupon_conditions: 'TEXT', observations: 'TEXT', category: 'TEXT' })) {
    if (!columns.has(name)) db.exec(`ALTER TABLE offers ADD COLUMN ${name} ${type}`);
  }
  migrateCaptions(db);
  return db;
}

function migrateCaptions(db) {
  if (db.prepare("SELECT 1 FROM settings WHERE key='caption_model_v2'").get()) return;
  const { buildCaption, legacyCaption, removeNotices } = require('./message');
  const saved = db.prepare("SELECT value FROM settings WHERE key='template'").get();
  let oldTemplate = LEGACY_TEMPLATE;
  try { if (saved) oldTemplate = JSON.parse(saved.value); } catch { /* usa padrão anterior */ }
  const template = oldTemplate === LEGACY_TEMPLATE ? DEFAULT_TEMPLATE : removeNotices(oldTemplate);
  db.exec('BEGIN');
  try {
    saveSettings(db, { template });
    const update = db.prepare('UPDATE offers SET caption=? WHERE id=?');
    for (const o of db.prepare('SELECT * FROM offers').all()) {
      const caption = o.caption === legacyCaption(oldTemplate, o) ? buildCaption(template, {
        name: o.name, priceMin: o.price_min, priceMax: o.price_max, link: o.affiliate_link,
        previousPrice: o.previous_price, sameVariant: o.previous_same_variant === 1,
        coupon: o.coupon, couponConditions: o.coupon_conditions, observations: o.observations,
      }) : removeNotices(o.caption);
      if (caption !== o.caption) update.run(caption, o.id);
    }
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('caption_model_v2', 'true');
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[row.key] = JSON.parse(row.value); } catch { /* ignora valor inválido */ }
  }
  return out;
}

function saveSettings(db, patch) {
  const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (k in patch) up.run(k, JSON.stringify(patch[k]));
  }
  return getSettings(db);
}

function log(db, kind, message, { mode = null, details = null } = {}) {
  db.prepare('INSERT INTO history(at,kind,mode,message,details) VALUES(?,?,?,?,?)')
    .run(new Date().toISOString(), kind, mode, String(message).slice(0, 500), details ? JSON.stringify(details).slice(0, 2000) : null);
}

module.exports = { open, getSettings, saveSettings, log, DEFAULT_SETTINGS, DEFAULT_TEMPLATE };
