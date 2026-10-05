const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const images = require('./images');
const { getSettings, log } = require('./db');
const { buildCaption } = require('./message');
const { getOffer, autoStatus } = require('./offers');

function validateLink(link) {
  if (typeof link !== 'string' || link.length > 4096 || /[\s\x00-\x1f\x7f]/.test(link)) throw new Error('Link de afiliado inválido; cole o link completo sem espaços.');
  let url;
  try { url = new URL(link); } catch { throw new Error('Link de afiliado inválido.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !(['shopee.com.br', 'shope.ee'].includes(host) || host.endsWith('.shopee.com.br')) || url.pathname === '/') {
    throw new Error('Use um link HTTPS da Shopee Brasil ou shope.ee para o produto.');
  }
  return link; // Nunca serializar a URL: preserva parâmetros e codificação originais.
}

function validateFields(body = {}) {
  const text = (key, max, required = false) => {
    if (body[key] != null && typeof body[key] !== 'string') throw new Error(`Campo inválido: ${key}.`);
    const value = (body[key] || '').trim();
    if (value.length > max || (required && !value) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error(`Preencha corretamente: ${key} (máximo ${max} caracteres).`);
    return value;
  };
  const price = (key, required = false) => {
    const raw = body[key];
    if (raw === '' || raw == null) {
      if (required) throw new Error('Informe o preço atual.');
      return null;
    }
    if (!['string', 'number'].includes(typeof raw) || !/^\d+(?:[.,]\d{1,2})?$/.test(String(raw))) throw new Error(`Preço inválido: ${key}. Use 99,90 ou 99.90.`);
    const n = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || n > 10000000) throw new Error('Preço deve ser positivo e até R$ 10 milhões.');
    return n;
  };
  const fields = {
    previous_same_variant: body.sameVariant === true ? 1 : 0,
    name: text('name', 200, true), affiliate_link: validateLink(body.affiliateLink),
    price_min: price('priceMin', true), price_max: price('priceMax'), previous_price: price('previousPrice'),
    category: text('category', 100, true), coupon: text('coupon', 100),
    coupon_conditions: text('couponConditions', 500), observations: text('observations', 1000),
  };
  fields.price_max ??= fields.price_min;
  if (fields.price_max < fields.price_min) throw new Error('O preço máximo deve ser maior ou igual ao mínimo.');
  if (fields.coupon_conditions && !fields.coupon) throw new Error('Informe o cupom junto com suas condições.');
  return fields;
}

async function prepareImage(body, cfg, required) {
  if (body.imageBase64 && body.imageUrl) throw new Error('Escolha upload ou URL de imagem.');
  let buffer;
  if (body.imageBase64) {
    if (typeof body.imageBase64 !== 'string' || body.imageBase64.length > Math.ceil(images.MAX_BYTES / 3) * 4) throw new Error('Imagem grande demais (máx. 6 MB).');
    if (body.imageBase64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.imageBase64)) throw new Error('Arquivo de imagem inválido.');
    buffer = Buffer.from(body.imageBase64, 'base64');
  } else if (body.imageUrl) {
    if (typeof body.imageUrl !== 'string' || body.imageUrl.length > 4096) throw new Error('URL de imagem inválida.');
    buffer = await images.downloadImage(body.imageUrl);
  } else if (required) throw new Error('Envie uma imagem ou informe sua URL HTTPS.');
  if (!buffer) return null;
  return images.saveManualImage(buffer, cfg.imagesDir);
}

async function saveManual({ db, cfg, body, id }) {
  const old = id == null ? null : getOffer(db, id);
  if (id != null && !old) throw new Error('Oferta não encontrada.');
  if (old && old.source !== 'manual') throw new Error('A edição dos dados cadastrados exige uma oferta Manual.');
  const fields = validateFields(body);
  const img = await prepareImage(body, cfg, !old);
  const caption = buildCaption(getSettings(db).template, {
    name: fields.name, priceMin: fields.price_min, priceMax: fields.price_max,
    link: fields.affiliate_link, previousPrice: fields.previous_price, sameVariant: fields.previous_same_variant === 1, coupon: fields.coupon,
    couponConditions: fields.coupon_conditions, observations: fields.observations,
  });
  const t = new Date().toISOString();
  const st = autoStatus({ affiliate_link: fields.affiliate_link, image_status: img?.status || old?.image_status, source: 'manual' });
  const data = { ...fields, caption, image_file: img?.file || old?.image_file,
    image_status: img?.status || old?.image_status, image_note: img?.note || old?.image_note,
    // Alterar uma oferta publicada gera uma nova preparação, que requer nova confirmação.
    status: st.status, review_reason: st.reason, updated_at: t, fetched_at: t };
  try {
    db.exec('BEGIN');
    if (old) {
      const keys = Object.keys(data);
      db.prepare(`UPDATE offers SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`).run(...Object.values(data), old.id);
    } else {
      Object.assign(data, { item_id: 'manual-' + crypto.randomUUID(), source: 'manual', created_at: t });
      const keys = Object.keys(data);
      id = Number(db.prepare(`INSERT INTO offers (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(data)).lastInsertRowid);
    }
    log(db, 'manual', `Oferta manual ${id}: ${old ? 'editada' : 'cadastrada'}`, { mode: 'manual' });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (img) await fs.promises.unlink(path.join(cfg.imagesDir, img.file)).catch(() => {});
    throw err;
  }
  return getOffer(db, id);
}

function duplicateOffer(db, id) {
  const old = getOffer(db, id);
  if (!old) throw new Error('Oferta não encontrada.');
  const t = new Date().toISOString();
  const st = autoStatus(old);
  const { id: ignored, ...data } = old;
  Object.assign(data, { status: st.status, review_reason: st.reason, created_at: t, updated_at: t });
  const keys = Object.keys(data);
  const newId = Number(db.prepare(`INSERT INTO offers (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(data)).lastInsertRowid);
  log(db, 'duplicacao', `Oferta ${id} duplicada como ${newId}`, { mode: old.source });
  return getOffer(db, newId);
}

module.exports = { validateLink, validateFields, saveManual, duplicateOffer };
