const crypto = require('node:crypto');

class ShopeeError extends Error {
  constructor(message, { code = null, retryable = false } = {}) {
    super(message);
    this.name = 'ShopeeError';
    this.code = code;
    this.retryable = retryable;
  }
}

// Mensagens amigáveis para os códigos de erro documentados pela Shopee.
const ERROR_HINTS = {
  10020: 'Assinatura/credencial inválida, app desativado ou horário do PC errado. Confira App ID, Secret e o relógio do computador.',
  10030: 'Limite de requisições excedido. Aguarde e tente de novo mais tarde.',
  10031: 'Acesso negado.',
  10032: 'ID de afiliado inválido.',
  10033: 'Conta de afiliado congelada.',
  10034: 'ID de afiliado em lista de bloqueio.',
  10035: 'Sua conta ainda não tem acesso à Open API de Afiliados. Solicite acesso no painel da Shopee.',
};

// Assinatura documentada: SHA256(AppId + Timestamp + Payload + Secret)
// Payload = corpo JSON exatamente como será enviado.
function sign({ appId, secret, timestamp, payload }) {
  return crypto.createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`).digest('hex');
}

function buildAuthHeader({ appId, secret, payload, timestamp = Math.floor(Date.now() / 1000) }) {
  const signature = sign({ appId, secret, timestamp, payload });
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

class ShopeeClient {
  constructor({ appId, secret, endpoint, timeoutMs = 15000, fetchImpl = fetch, retries = 2, retryDelayMs = 800, minIntervalMs = 700 }) {
    Object.assign(this, { appId, secret, endpoint, timeoutMs, fetchImpl, retries, retryDelayMs, minIntervalMs });
    this._last = 0;
  }

  // Intervalo mínimo entre chamadas: os limites exatos da API não foram verificados, então somos conservadores.
  async _throttle() {
    const wait = this._last + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this._last = Date.now();
  }

  async graphql(query) {
    const body = JSON.stringify({ query });
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await this._once(body);
      } catch (err) {
        lastErr = err;
        if (!(err instanceof ShopeeError) || !err.retryable || attempt === this.retries) break;
        await new Promise(r => setTimeout(r, this.retryDelayMs * 2 ** attempt));
      }
    }
    throw lastErr;
  }

  async _once(body) {
    await this._throttle();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: buildAuthHeader({ appId: this.appId, secret: this.secret, payload: body }),
        },
        body,
        signal: ctrl.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new ShopeeError('A Shopee demorou demais para responder (timeout).', { retryable: true });
      throw new ShopeeError(`Falha de rede ao falar com a Shopee: ${err.message}`, { retryable: true });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) throw new ShopeeError(ERROR_HINTS[10030], { code: 10030, retryable: true });
    if (res.status >= 500) throw new ShopeeError(`Erro no servidor da Shopee (HTTP ${res.status}).`, { retryable: true });

    let json;
    try { json = await res.json(); } catch { throw new ShopeeError(`Resposta inválida da Shopee (HTTP ${res.status}).`); }

    if (json.errors && json.errors.length) {
      const e = json.errors[0];
      const code = e.extensions?.code ?? null;
      throw new ShopeeError(ERROR_HINTS[code] || e.message || 'Erro desconhecido da API.', { code, retryable: code === 10030 });
    }
    if (!res.ok) throw new ShopeeError(`A Shopee respondeu HTTP ${res.status}.`);
    return json.data;
  }

  // Campos de productOfferV2 conforme documentação consultada (ver README, seção "Verificação").
  async searchProducts({ keyword, categoryId, itemId, page = 1, limit = 20, sortType = 5 }) {
    const args = [`page:${Number(page)}`, `limit:${Number(limit)}`, `sortType:${Number(sortType)}`];
    if (keyword) args.push(`keyword:${JSON.stringify(String(keyword))}`);
    if (categoryId) args.push(`productCatId:${Number(categoryId)}`);
    if (itemId) args.push(`itemId:${Number(itemId)}`);
    const query = `{ productOfferV2(${args.join(',')}) {
      nodes { itemId productName priceMin priceMax imageUrl productLink offerLink shopId shopName }
    } }`;
    const data = await this.graphql(query);
    const conn = data?.productOfferV2;
    const nodes = (conn?.nodes || []).map(normalizeNode);
    // Não pedimos pageInfo (subcampos não confirmados): página cheia = provavelmente há mais.
    return { nodes, hasNextPage: nodes.length >= Number(limit) };
  }

  async generateShortLink(originUrl, subIds = []) {
    const subs = (subIds || []).slice(0, 5).map(s => JSON.stringify(String(s))).join(',');
    const query = `mutation { generateShortLink(input:{originUrl:${JSON.stringify(originUrl)}${subs ? `,subIds:[${subs}]` : ''}}) { shortLink } }`;
    const data = await this.graphql(query);
    const link = data?.generateShortLink?.shortLink;
    if (!link) throw new ShopeeError('A Shopee não devolveu o link de afiliado.');
    return link;
  }
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeNode(n) {
  return {
    itemId: String(n.itemId),
    shopId: n.shopId != null ? String(n.shopId) : null,
    name: String(n.productName || '').trim(),
    priceMin: toNum(n.priceMin),
    priceMax: toNum(n.priceMax),
    imageUrl: n.imageUrl || null,
    productLink: n.productLink || null,
    offerLink: n.offerLink || null,
  };
}

// ---------- MODO DEMONSTRAÇÃO ----------
// Dados 100% fictícios, sempre marcados como source = 'demo' e com "[DEMO]" no nome.
function demoSearch({ keyword, page = 1, limit = 20 }) {
  const base = (keyword || 'produto').trim();
  const slug = base.replace(/\W+/g, '').toLowerCase();
  const nodes = [];
  for (let i = 0; i < Math.min(limit, 6); i++) {
    const n = (page - 1) * 6 + i + 1;
    nodes.push({
      itemId: `DEMO-${slug}-${n}`,
      shopId: 'DEMO',
      name: `[DEMO] ${base} exemplo ${n}`,
      priceMin: 19.9 + n * 10,
      priceMax: n % 2 ? 19.9 + n * 10 : 39.9 + n * 10,
      imageUrl: null,
      productLink: null,
      offerLink: null,
    });
  }
  return { nodes, hasNextPage: page < 2 };
}

module.exports = { ShopeeClient, ShopeeError, sign, buildAuthHeader, demoSearch, normalizeNode, ERROR_HINTS };
