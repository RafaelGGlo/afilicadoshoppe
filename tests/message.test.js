const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPrice, buildCaption } = require('../src/message');
const { DEFAULT_TEMPLATE } = require('../src/db');

const nbsp = s => s.replace(/\u00a0/g, ' ');

test('preço único', () => assert.equal(nbsp(formatPrice(49.9, 49.9)), 'R$ 49,90'));
test('faixa de preço (variantes) mostra preço inicial e máximo', () => {
  assert.equal(nbsp(formatPrice(29.9, 59.9)), 'A partir de R$ 29,90 — varia até R$ 59,90');
});
test('só um dos preços informado vira preço único', () => assert.equal(nbsp(formatPrice(null, 10)), 'R$ 10,00'));
test('sem preço: não inventa valor', () => assert.equal(formatPrice(null, null), 'Preço no link'));

test('legenda padrão sem avisos removidos nem dados promocionais inventados', () => {
  const c = nbsp(buildCaption(DEFAULT_TEMPLATE, { name: 'Fone X', priceMin: 50, priceMax: 50, link: 'https://shope.ee/abc' }));
  assert.match(c, /Fone X/);
  assert.match(c, /R\$ 50,00/);
  assert.match(c, /https:\/\/shope\.ee\/abc/);
  assert.match(c, /^🔥 OFERTA SHOPEE!/);
  assert.doesNotMatch(c, /Preço e disponibilidade podem mudar|posso receber comissão/);
  assert.doesNotMatch(c, /cupom|frete grátis|últimas unidades|de R\$|desconto/i);
});

test('preço anterior e desconto exigem variante confirmada e preço único menor', () => {
  const base = { name: 'Fone', priceMin: 80, priceMax: 80, previousPrice: 100, link: 'https://shope.ee/a', sameVariant: true };
  assert.equal(nbsp(buildCaption(DEFAULT_TEMPLATE, base)), '🔥 OFERTA SHOPEE!\nFone\n💰 De R$ 100,00 por R$ 80,00\n📉 20,0% de desconto!\n🛒 Compre aqui: https://shope.ee/a');
  for (const patch of [{ sameVariant: false }, { sameVariant: undefined }, { sameVariant: 'true' }, { previousPrice: 80 }, { previousPrice: 60 }, { previousPrice: 0 }, { previousPrice: NaN }, { previousPrice: Infinity }]) {
    const c = nbsp(buildCaption(DEFAULT_TEMPLATE, { ...base, ...patch }));
    assert.match(c, /💰 R\$ 80,00/); assert.doesNotMatch(c, /De R\$|📉|desconto/i);
  }
  const range = nbsp(buildCaption(DEFAULT_TEMPLATE, { ...base, priceMax: 90 }));
  assert.match(range, /A partir de R\$ 80,00 — varia até R\$ 90,00/);
  assert.doesNotMatch(range, /De R\$|100,00|📉/);
});

test('cálculo e arredondamento brasileiro sempre com uma casa decimal', () => {
  for (const [previousPrice, priceMin, expected] of [[100, 50, '50,0'], [3, 2, '33,3'], [3, 1, '66,7'], [199.9, 149.9, '25,0'], [100, 99.99, '0,0']]) {
    const caption = buildCaption(DEFAULT_TEMPLATE, { name: 'Teste', previousPrice, priceMin, priceMax: priceMin, sameVariant: true, link: 'https://shope.ee/x' });
    assert.ok(caption.includes(`📉 ${expected}% de desconto!`), caption);
  }
});

test('observações e cupom opcionais sem linhas vazias, placeholders ou avisos removidos', () => {
  const c = buildCaption(DEFAULT_TEMPLATE, { name: 'Nome {link}', priceMin: 10, priceMax: 10, link: 'https://shope.ee/x?a=%2fb&x=1&x=2', observations: 'Cor azul', coupon: 'AZUL', couponConditions: 'Acima de R$ 50' });
  assert.match(c, /Observações: Cor azul\n🎟️ Cupom: AZUL — Acima de R\$ 50\n🛒/);
  assert.ok(c.includes('Nome {link}')); assert.ok(c.endsWith('https://shope.ee/x?a=%2fb&x=1&x=2'));
  assert.doesNotMatch(c, /\n\n|\{extras\}|\{desconto\}/);
});
test('link ausente não quebra a legenda', () => {
  assert.match(buildCaption(DEFAULT_TEMPLATE, { name: 'A', priceMin: 1, priceMax: 1, link: null }), /link indisponível/);
});

test('migra padrão e legendas antigas sem apagar legenda personalizada nem confirmar variante', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const dbm = require('../src/db');
  const { legacyCaption } = require('../src/message');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'caption-migration-')), 'offers.db');
  const oldTemplate = '🔥 Oferta Shopee!\n{nome}\n💰 {preco}\n🛒 Compre aqui: {link}\n\nPreço e disponibilidade podem mudar.\nLink de afiliado: posso receber comissão pela compra.';
  const old = dbm.open(file);
  dbm.saveSettings(old, { template: oldTemplate });
  old.prepare("DELETE FROM settings WHERE key='caption_model_v2'").run();
  const row = { name: 'Produto', price_min: 80, price_max: 80, previous_price: 100, affiliate_link: 'https://shope.ee/x', coupon: 'CUPOM' };
  const insert = old.prepare('INSERT INTO offers(item_id,name,price_min,price_max,previous_price,affiliate_link,coupon,caption,status,source,fetched_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('1', row.name, 80, 80, 100, row.affiliate_link, row.coupon, legacyCaption(oldTemplate, row), 'preparada', 'manual', '2026', '2026', '2026');
  insert.run('2', row.name, 80, 80, 100, row.affiliate_link, row.coupon, 'Meu texto editado\nPreço e disponibilidade podem mudar.\nLink de afiliado: posso receber comissão pela compra.', 'publicada', 'manual', '2026', '2026', '2026');
  old.close();
  const migrated = dbm.open(file);
  try {
    assert.equal(dbm.getSettings(migrated).template, DEFAULT_TEMPLATE);
    const rows = migrated.prepare('SELECT * FROM offers ORDER BY id').all();
    assert.match(rows[0].caption, /^🔥 OFERTA SHOPEE!/);
    assert.doesNotMatch(rows[0].caption, /📉|Preço anterior|De R\$|posso receber comissão/);
    assert.match(rows[0].caption, /CUPOM/);
    assert.equal(rows[0].previous_same_variant, 0);
    assert.equal(rows[1].caption, 'Meu texto editado'); assert.equal(rows[1].status, 'publicada');
  } finally { migrated.close(); }
  const second = dbm.open(file);
  try { assert.equal(second.prepare('SELECT caption FROM offers WHERE id=2').get().caption, 'Meu texto editado'); }
  finally { second.close(); }
});
