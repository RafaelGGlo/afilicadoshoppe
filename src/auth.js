const crypto = require('node:crypto');

const COOKIE = 'painel_sessao';
const MAX_AGE_MS = 12 * 3600 * 1000;

const hmac = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('hex');

function sha(text) { return crypto.createHash('sha256').update(String(text)).digest(); }

function passwordMatches(input, expected) {
  return crypto.timingSafeEqual(sha(input), sha(expected));
}

function makeToken(secret, now = Date.now()) {
  const exp = String(now + MAX_AGE_MS);
  return `${exp}.${hmac(secret, exp)}`;
}

function tokenValid(secret, token, now = Date.now()) {
  if (!token || typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < now) return false;
  const good = hmac(secret, exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Limita tentativas de login por IP (5 a cada 10 min).
function createLoginLimiter({ max = 5, windowMs = 600000 } = {}) {
  const hits = new Map();
  return {
    check(ip, now = Date.now()) {
      const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
      hits.set(ip, arr);
      return arr.length < max;
    },
    fail(ip, now = Date.now()) { hits.set(ip, [...(hits.get(ip) || []), now]); },
    reset(ip) { hits.delete(ip); },
  };
}

module.exports = { COOKIE, MAX_AGE_MS, passwordMatches, makeToken, tokenValid, parseCookies, createLoginLimiter };
