// Monta o preço e a legenda SEM inventar nada: só usa o que veio da API.

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatPrice(priceMin, priceMax) {
  const hasMin = typeof priceMin === 'number' && Number.isFinite(priceMin);
  const hasMax = typeof priceMax === 'number' && Number.isFinite(priceMax);
  if (!hasMin && !hasMax) return 'Preço no link';
  const min = hasMin ? priceMin : priceMax;
  const max = hasMax ? priceMax : priceMin;
  if (min === max) return brl.format(min);
  // Produto com variantes: informa faixa de preço (e o preço inicial).
  return `A partir de ${brl.format(Math.min(min, max))} — varia até ${brl.format(Math.max(min, max))}`;
}

const PLACEHOLDERS = ['{nome}', '{preco}', '{desconto}', '{extras}', '{link}'];

function removeNotices(text) {
  return String(text || '').split('Preço e disponibilidade podem mudar.').join('')
    .split('Link de afiliado: posso receber comissão pela compra.').join('').trim();
}

function buildCaption(template, { name, priceMin, priceMax, link, previousPrice, sameVariant = false, coupon, couponConditions, observations }) {
  const current = Number.isFinite(priceMin) ? priceMin : priceMax;
  const singlePrice = Number.isFinite(current) && (!Number.isFinite(priceMin) || !Number.isFinite(priceMax) || priceMin === priceMax);
  const validDiscount = sameVariant === true && singlePrice && current > 0 && Number.isFinite(previousPrice) && previousPrice > current;
  const discount = validDiscount ? '📉 ' + ((previousPrice - current) / previousPrice * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '% de desconto!' : '';
  const extra = [];
  if (observations?.trim()) extra.push('Observações: ' + observations.trim());
  if (coupon?.trim()) extra.push('🎟️ Cupom: ' + coupon.trim() + (couponConditions?.trim() ? ' — ' + couponConditions.trim() : ''));
  const values = {
    '{nome}': name || '',
    '{preco}': validDiscount ? `De ${brl.format(previousPrice)} por ${brl.format(current)}` : formatPrice(priceMin, priceMax),
    '{desconto}': discount,
    '{extras}': extra.join('\n'),
    '{link}': link || '(link indisponível)',
  };
  const model = removeNotices(template);
  // Substituição única: conteúdo digitado não é interpretado como outro placeholder.
  let out = model.replace(/\{nome\}|\{preco\}|\{desconto\}|\{extras\}|\{link\}/g, key => values[key]);
  const missing = [];
  if (!model.includes('{desconto}') && discount) missing.push(discount);
  if (!model.includes('{extras}')) missing.push(...extra);
  if (missing.length) {
    const marker = out.indexOf('🛒');
    out = marker >= 0 ? out.slice(0, marker) + missing.join('\n') + '\n' + out.slice(marker) : out + '\n' + missing.join('\n');
  }
  return out.split('\n').filter(line => line.trim()).join('\n').trim();
}

// Identifica legendas automáticas da versão anterior para migrá-las sem apagar edições.
function legacyCaption(template, o) {
  const oldPrice = formatPrice(o.price_min, o.price_max).replace(/^A partir de (.*) — varia até (.*)$/, 'a partir de $1 (varia até $2)');
  let out = String(template || '');
  for (const [key, value] of Object.entries({ '{nome}': o.name || '', '{preco}': oldPrice, '{link}': o.affiliate_link || '(link indisponível)' })) out = out.split(key).join(value);
  const extra = [];
  if (Number.isFinite(o.previous_price) && o.previous_price > 0) {
    extra.push('Preço anterior: ' + brl.format(o.previous_price));
    if (o.price_min === o.price_max && o.price_min > 0 && o.previous_price > o.price_min) extra.push('Desconto: ' + ((o.previous_price - o.price_min) / o.previous_price * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
  }
  if (o.coupon) extra.push('🎟️ Cupom: ' + o.coupon + (o.coupon_conditions ? ' — ' + o.coupon_conditions : ''));
  if (o.observations) extra.push('Observações: ' + o.observations);
  if (extra.length) {
    const marker = out.indexOf('🛒');
    out = marker >= 0 ? out.slice(0, marker) + extra.join('\n') + '\n\n' + out.slice(marker) : out + '\n\n' + extra.join('\n');
  }
  return out.trim();
}

module.exports = { formatPrice, buildCaption, PLACEHOLDERS, removeNotices, legacyCaption };
