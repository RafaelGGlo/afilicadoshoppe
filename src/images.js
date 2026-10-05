const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const MAX_BYTES = 6 * 1024 * 1024;       // 6 MB
const MIN_SIDE = 500;                    // resolução mínima (lado menor) para considerar adequada
const MAX_SIDE = 1600;                   // reduz imagens enormes (sem cortar nem editar)
const MAX_REDIRECTS = 3;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

// ---------- proteção contra URLs internas (SSRF) ----------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 2) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const x = new URL('https://[' + ip + ']').hostname.slice(1, -1).toLowerCase();
    if (x.startsWith('::ffff:')) {
      const parts = x.slice(7).split(':');
      if (parts.length === 2) {
        const n = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16);
        return isPrivateIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
      }
    }
    // Somente IPv6 global unicast, sem túneis ou redes de documentação.
    if (!/^[23][0-9a-f]{3}:/.test(x)) return true;
    if (x.startsWith('2001:db8:') || x.startsWith('2001:0:') || x.startsWith('2002:')) return true;
    if (x === '::' || x === '::1') return true;
    if (x.startsWith('::ffff:')) return isPrivateIp(x.slice(7)); // IPv4 dentro de IPv6
    return x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
  }
  return true; // formato desconhecido: bloqueia
}

// lookup usado na conexão real: valida o IP que de fato será usado (evita DNS rebinding).
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
    const bad = list.find(a => isPrivateIp(a.address));
    if (bad || list.length === 0) return callback(new Error('Endereço de destino não permitido (rede interna).'));
    if (options && options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('URL de imagem inválida.'); }
  if (u.protocol !== 'https:') throw new Error('Só são aceitas imagens por HTTPS.');
  if (u.username || u.password) throw new Error('URL com usuário/senha não é permitida.');
  if (u.port && u.port !== '443') throw new Error('Porta não permitida.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateIp(host)) throw new Error('Endereço de destino não permitido.');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error('Endereço de destino não permitido.');
  return u;
}

function getOnce(url, { timeoutMs, lookup }) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { lookup, timeout: timeoutMs, headers: { 'User-Agent': 'shopee-ofertas/1.0', Accept: 'image/*' } }, res => {
      res.once('close', () => clearTimeout(deadline));
      resolve(res);
    });
    // Limite total por conexão, inclusive DNS e corpo lento; não apenas inatividade.
    const deadline = setTimeout(() => req.destroy(new Error('Tempo esgotado ao baixar a imagem.')), timeoutMs);
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao baixar a imagem.')));
    req.on('error', err => { clearTimeout(deadline); reject(err); });
  });
}

async function downloadImage(rawUrl, { timeoutMs = 10000, lookup = safeLookup } = {}) {
  let url = checkUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await getOnce(url, { timeoutMs, lookup });
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      url = checkUrl(new URL(res.headers.location, url).toString()); // revalida a cada redirecionamento
      continue;
    }
    if (res.statusCode !== 200) { res.resume(); throw new Error(`Download falhou (HTTP ${res.statusCode}).`); }
    const declared = Number(res.headers['content-length'] || 0);
    if (declared > MAX_BYTES) { res.destroy(); throw new Error('Imagem grande demais.'); }
    const chunks = [];
    let total = 0;
    for await (const chunk of res) {
      total += chunk.length;
      if (total > MAX_BYTES) { res.destroy(); throw new Error('Imagem grande demais.'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Redirecionamentos demais.');
}

// ---------- validação e gravação ----------
// Confere o conteúdo REAL do arquivo (não confia no Content-Type). Só reduz tamanho / converte para JPEG.
async function processBuffer(buf) {
  if (!buf || buf.length === 0) throw new Error('Arquivo vazio.');
  if (buf.length > MAX_BYTES) throw new Error('Imagem grande demais (máx. 6 MB).');
  let meta;
  try { meta = await sharp(buf, { limitInputPixels: 50_000_000 }).metadata(); }
  catch { throw new Error('O arquivo não é uma imagem válida.'); }
  if (!ALLOWED_FORMATS.has(meta.format)) throw new Error('Formato não permitido (use JPG, PNG ou WebP).');
  if ((meta.pages || 1) > 1) throw new Error('Use uma imagem estática, sem animação.');
  const side = Math.min(meta.width || 0, meta.height || 0);
  const out = await sharp(buf, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { buffer: out, width: meta.width, height: meta.height, lowRes: side < MIN_SIDE };
}

async function saveBuffer(dir, buf) {
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}.jpg`;
  await fs.promises.writeFile(path.join(dir, name), buf);
  return name;
}

// Resultado: { status: 'ok' | 'none' | 'falhou', file, note }
async function fetchApiImage(imageUrl, dir, opts = {}) {
  if (!imageUrl) return { status: 'none', file: null, note: 'A API não retornou imagem para este produto.' };
  try {
    const raw = await downloadImage(imageUrl, opts);
    const p = await processBuffer(raw);
    const file = await saveBuffer(dir, p.buffer);
    if (p.lowRes) return { status: 'falhou', file, note: `Resolução baixa (${p.width}x${p.height}). Envie uma imagem melhor manualmente.` };
    return { status: 'ok', file, note: `${p.width}x${p.height}` };
  } catch (err) {
    return { status: 'falhou', file: null, note: err.message };
  }
}

async function saveManualImage(buf, dir) {
  const p = await processBuffer(buf);
  const file = await saveBuffer(dir, p.buffer);
  return { file, status: p.lowRes ? 'falhou' : 'manual', note: `Enviada manualmente (${p.width}x${p.height})${p.lowRes ? ' — resolução baixa; substitua por uma imagem melhor' : ''}` };
}

module.exports = { isPrivateIp, checkUrl, downloadImage, processBuffer, fetchApiImage, saveManualImage, safeLookup, MAX_BYTES, MIN_SIDE };
