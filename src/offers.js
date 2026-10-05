const { getSettings, log } = require('./db');
const { buildCaption } = require('./message');
const { demoSearch, ShopeeError } = require('./shopee');
const images = require('./images');

const STATUSES = ['preparada', 'revisao', 'publicada', 'descartada'];

const now = () => new Date().toISOString();

function inPriceRange(node, min, max) {
  const lo = node.priceMin ?? node.priceMax;
  const hi = node.priceMax ?? node.priceMin;
  if (lo == null && hi == null) return true; // sem preço na API: deixa passar, vai pra legenda "Preço no link"
  if (min !== '' && min != null && hi < Number(min)) return false;
  if (max !== '' && max != null && lo > Number(max)) return false;
  return true;
}

function wasUsedRecently(db, itemId, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const row = db.prepare('SELECT 1 FROM offers WHERE item_id = ? AND created_at >= ? LIMIT 1').get(String(itemId), since);
  return !!row;
}

// Decide o status automático (só para ofertas ainda "abertas").
function autoStatus({ affiliate_link, image_status, source }) {
  if (source === 'demo') return { status: 'revisao', reason: 'Oferta de DEMONSTRAÇÃO (dados simulados). Não use para divulgar.' };
  if (!affiliate_link) return { status: 'revisao', reason: 'Sem link de afiliado.' };
  if (image_status !== 'ok' && image_status !== 'manual') return { status: 'revisao', reason: 'Sem imagem adequada. Envie uma manualmente.' };
  return { status: 'preparada', reason: null };
}

async function resolveLink(client, node, subIds) {
  if (!client) return { link: null, note: 'Modo demonstração: sem link real.' };
  if (node.productLink) {
    try { return { link: await client.generateShortLink(node.productLink, subIds), note: null }; }
    catch (err) {
      if (node.offerLink) return { link: node.offerLink, note: `generateShortLink falhou (${err.message}); usado o offerLink da API.` };
      throw err;
    }
  }
  if (node.offerLink) return { link: node.offerLink, note: null };
  return { link: null, note: 'A API não retornou link do produto.' };
}

async function createOffer({ db, client, cfg, settings, node, keyword, source }) {
  const { link, note } = await resolveLink(client, node, settings.subIds);
  const img = await images.fetchApiImage(node.imageUrl, cfg.imagesDir);
  const base = {
    affiliate_link: link,
    image_status: img.status === 'ok' ? 'ok' : img.status,
    source,
  };
  const st = autoStatus(base);
  const caption = buildCaption(settings.template, { name: node.name, priceMin: node.priceMin, priceMax: node.priceMax, link });
  const t = now();
  const reason = [st.reason, note].filter(Boolean).join(' ') || null;
  const r = db.prepare(`INSERT INTO offers
    (item_id,shop_id,name,price_min,price_max,product_link,affiliate_link,api_image_url,image_file,image_status,image_note,caption,status,review_reason,source,keyword,fetched_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    node.itemId, node.shopId, node.name, node.priceMin, node.priceMax, node.productLink, link,
    node.imageUrl, img.file, img.status, img.note, caption, st.status, reason, source, keyword, t, t, t);
  return Number(r.lastInsertRowid);
}

// Consulta a API (ou o modo demo) e cria ofertas novas, sem repetir produtos.
async function runSearch({ db, client, cfg, keyword = null, trigger = 'manual' }) {
  const settings = getSettings(db);
  const mode = client ? 'api' : 'demo';
  const source = client ? 'api' : 'demo';
  const keywords = keyword ? [keyword] : settings.keywords.filter(Boolean);
  const categories = settings.categoryIds.length ? settings.categoryIds : [null];
  const summary = { mode, trigger, seen: 0, created: 0, skippedDuplicate: 0, skippedPrice: 0, errors: [], ids: [] };
  const seenThisRun = new Set();

  if (!keywords.length && categories[0] === null) {
    summary.errors.push('Nenhuma palavra-chave ou categoria configurada.');
    log(db, 'erro', summary.errors[0], { mode });
    return summary;
  }

  outer:
  for (const kw of keywords.length ? keywords : [null]) {
    for (const cat of categories) {
      for (let page = 1; page <= settings.pagesPerQuery; page++) {
        let result;
        try {
          result = client
            ? await client.searchProducts({ keyword: kw, categoryId: cat, page, limit: settings.pageSize, sortType: settings.sortType })
            : demoSearch({ keyword: kw, page, limit: settings.pageSize });
        } catch (err) {
          const msg = err instanceof ShopeeError ? err.message : `Erro inesperado: ${err.message}`;
          summary.errors.push(`${kw || 'categoria ' + cat}: ${msg}`);
          log(db, 'erro', `Consulta falhou (${kw || 'categoria ' + cat}): ${msg}`, { mode, details: { code: err.code ?? null } });
          if (err.code === 10030 || err.code === 10020 || err.code === 10035) break outer; // limite/credencial: para tudo
          break; // próxima combinação
        }
        for (const node of result.nodes) {
          summary.seen++;
          if (!node.name || !node.itemId) continue;
          if (seenThisRun.has(node.itemId) || wasUsedRecently(db, node.itemId, settings.dedupeDays)) { summary.skippedDuplicate++; continue; }
          if (!inPriceRange(node, settings.priceMin, settings.priceMax)) { summary.skippedPrice++; continue; }
          seenThisRun.add(node.itemId);
          try {
            summary.ids.push(await createOffer({ db, client, cfg, settings, node, keyword: kw, source }));
            summary.created++;
          } catch (err) {
            summary.errors.push(`${node.name.slice(0, 40)}: ${err.message}`);
            log(db, 'erro', `Falha ao preparar "${node.name.slice(0, 60)}": ${err.message}`, { mode });
            if (err.code === 10030) break outer;
          }
          if (summary.created >= settings.maxPerRun) break outer;
        }
        if (!result.hasNextPage) break;
      }
    }
  }
  log(db, 'consulta',
    `${trigger === 'auto' ? 'Consulta automática' : 'Consulta manual'}: ${summary.created} nova(s), ${summary.skippedDuplicate} repetida(s), ${summary.skippedPrice} fora do preço, ${summary.errors.length} erro(s)`,
    { mode, details: { keywords, seen: summary.seen } });
  return summary;
}

function getOffer(db, id) {
  return db.prepare('SELECT * FROM offers WHERE id = ?').get(Number(id));
}

// Antes de divulgar: reconsulta a API para atualizar preço/nome e regenera a legenda.
async function refreshOffer({ db, client, cfg, id }) {
  const offer = getOffer(db, id);
  if (!offer) throw new Error('Oferta não encontrada.');
  const settings = getSettings(db);
  const t = now();

  if (offer.source === 'manual') {
    return { offer, refreshed: false, note: 'Oferta manual: confira os dados cadastrados antes de publicar.' };
  }
  if (offer.source === 'demo' || !client) {
    db.prepare('UPDATE offers SET updated_at=? WHERE id=?').run(t, offer.id);
    return { offer: getOffer(db, id), refreshed: false, note: 'Oferta de demonstração: nada para atualizar na Shopee.' };
  }

  let found;
  try {
    const r = await client.searchProducts({ itemId: offer.item_id, limit: 1 });
    found = r.nodes.find(n => n.itemId === offer.item_id);
  } catch (err) {
    log(db, 'erro', `Falha ao atualizar oferta ${offer.id}: ${err.message}`, { mode: 'api' });
    throw err;
  }

  if (!found) {
    db.prepare(`UPDATE offers SET status = CASE WHEN status IN ('publicada','descartada') THEN status ELSE 'revisao' END,
      review_reason = ?, updated_at = ? WHERE id = ?`).run('Produto não encontrado na API na atualização (pode ter saído do ar).', t, offer.id);
    return { offer: getOffer(db, id), refreshed: false, note: 'Produto não encontrado na API.' };
  }

  const caption = buildCaption(settings.template, { name: found.name, priceMin: found.priceMin, priceMax: found.priceMax, link: offer.affiliate_link });
  db.prepare('UPDATE offers SET name=?, price_min=?, price_max=?, caption=?, fetched_at=?, updated_at=? WHERE id=?')
    .run(found.name, found.priceMin, found.priceMax, caption, t, t, offer.id);
  recomputeStatus(db, offer.id);
  log(db, 'info', `Dados atualizados antes da publicação: oferta ${offer.id}`, { mode: 'api' });
  return { offer: getOffer(db, id), refreshed: true, note: 'Dados atualizados agora.' };
}

// Reavalia o status de ofertas "abertas" (preparada/revisao). Nunca mexe em publicada/descartada.
function recomputeStatus(db, id) {
  const o = getOffer(db, id);
  if (!o || !['preparada', 'revisao'].includes(o.status)) return o;
  const st = autoStatus(o);
  db.prepare('UPDATE offers SET status=?, review_reason=?, updated_at=? WHERE id=?').run(st.status, st.reason, now(), o.id);
  return getOffer(db, id);
}

function setStatus(db, id, status) {
  if (!STATUSES.includes(status)) throw new Error('Status inválido.');
  const o = getOffer(db, id);
  if (!o) throw new Error('Oferta não encontrada.');
  if (status === 'preparada') {
    const st = autoStatus(o);
    if (st.status !== 'preparada') throw new Error(`Não dá para marcar como preparada: ${st.reason}`);
  }
  db.prepare('UPDATE offers SET status=?, review_reason=?, updated_at=? WHERE id=?')
    .run(status, status === 'revisao' ? (o.review_reason || 'Marcada para revisão manualmente.') : null, now(), o.id);
  log(db, 'status', `Oferta ${id}: ${status}`, { mode: o.source });
  return getOffer(db, id);
}

function setCaption(db, id, caption) {
  const text = String(caption ?? '').slice(0, 4000);
  db.prepare('UPDATE offers SET caption=?, updated_at=? WHERE id=?').run(text, now(), Number(id));
  return getOffer(db, id);
}

function resetCaption(db, id) {
  const o = getOffer(db, id);
  if (!o) throw new Error('Oferta não encontrada.');
  const s = getSettings(db);
  return setCaption(db, id, buildCaption(s.template, { name: o.name, priceMin: o.price_min, priceMax: o.price_max, link: o.affiliate_link, previousPrice: o.previous_price, sameVariant: o.previous_same_variant === 1, coupon: o.coupon, couponConditions: o.coupon_conditions, observations: o.observations }));
}

async function attachManualImage({ db, cfg, id, buffer }) {
  const o = getOffer(db, id);
  if (!o) throw new Error('Oferta não encontrada.');
  const r = await images.saveManualImage(buffer, cfg.imagesDir);
  db.prepare('UPDATE offers SET image_file=?, image_status=?, image_note=?, updated_at=? WHERE id=?').run(r.file, r.status, r.note, now(), o.id);
  return recomputeStatus(db, o.id);
}

function listOffers(db, { status, q, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (status && STATUSES.includes(status)) { where.push('status = ?'); args.push(status); }
  if (q) { where.push('name LIKE ?'); args.push(`%${String(q).slice(0, 80)}%`); }
  const sql = `SELECT * FROM offers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
  return db.prepare(sql).all(...args, Math.min(Number(limit) || 200, 500));
}

module.exports = { runSearch, refreshOffer, recomputeStatus, setStatus, setCaption, resetCaption, attachManualImage, listOffers, getOffer, inPriceRange, wasUsedRecently, autoStatus, STATUSES };
