const money = n => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const clean = s => String(s ?? '').replace(/[*_~`\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
export function shortTitle(value, limit = 120) {
 const title = clean(value).replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/\s+[|–—-]\s*(?:frete gr[aá]tis|oferta imperd[ií]vel|promo[cç][aã]o imperd[ií]vel|compre agora)\b.*$/iu, '').replace(/\s+/g, ' ').trim();
 const characters = Array.from(title);
 if (characters.length <= limit) return title;
 const part = characters.slice(0, limit - 1).join('');
 const space = part.lastIndexOf(' ');
 return (space >= limit * 0.6 ? part.slice(0, space) : part).trimEnd() + '…';
}
export function formatDeal(d, link) {
 if (d.testOnly === true) {
  return ['🧪 *TESTE DO BOT — NÃO É UMA OFERTA REAL*', clean(d.title).slice(0,300),
   ...(typeof d.price === 'number' && Number.isFinite(d.price) && d.price > 0 ? [`Preço fictício para teste: ${money(d.price)}`] : []),
   '', 'Mensagem de teste com imagem e legenda.', `Página da loja (sem afiliação): ${link}`,
   'Não há produto, promoção ou comissão associados a este teste.'].join('\n');
 }
 if (!d.title || typeof d.price !== 'number' || !Number.isFinite(d.price) || d.price <= 0) throw Error('Title and valid numeric price required');
 const title = shortTitle(d.title);
 if (!title) throw Error('Readable product title required');
 const price = `*${money(d.price)}*`;
 const hasOldPrice = typeof d.oldPrice === 'number' && Number.isFinite(d.oldPrice) && d.oldPrice > d.price;
 return [`*${title}*`, '',
  hasOldPrice && !d.fromPrice ? `De ~${money(d.oldPrice)}~ por ${price}` : `${d.fromPrice ? 'Menor preço:' : 'Por'} ${price}`,
  ...(d.coupon ? [`Cupom: *${clean(d.coupon).slice(0,40)}*`] : []),
  '', link].join('\n');
}
