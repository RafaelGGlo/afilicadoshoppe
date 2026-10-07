const money = n => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const clean = s => String(s ?? '').replace(/[*_~`\r\n]/g, ' ').trim();
export function formatDeal(d, link) {
 if (d.testOnly === true) {
   return ['🧪 *TESTE DO BOT — NÃO É UMA OFERTA REAL*', clean(d.title).slice(0,300),
     ...(typeof d.price === 'number' && Number.isFinite(d.price) && d.price > 0 ? [`Preço fictício para teste: ${money(d.price)}`] : []),
     '', 'Mensagem de teste com imagem e legenda.', `Página da loja (sem afiliação): ${link}`,
     'Não há produto, promoção ou comissão associados a este teste.'].join('\n');
 }
 if (!d.title || typeof d.price !== 'number' || !Number.isFinite(d.price) || d.price <= 0) throw Error('Title and valid numeric price required');
 const title = clean(d.title).slice(0,300);
 const price = `*${money(d.price)}*`;
 const hasOldPrice = typeof d.oldPrice === 'number' && Number.isFinite(d.oldPrice) && d.oldPrice > d.price;
 return [...(d.headline ? [`*${clean(d.headline).slice(0,120)}*`, ''] : []), title, '',
   hasOldPrice && !d.fromPrice ? `De ~${money(d.oldPrice)}~ por ${price} 🔥` : `${d.fromPrice ? 'Menor preço:' : 'Por'} ${price} 🔥`,
   ...(d.coupon ? [`🎟️ Cupom: *${clean(d.coupon).slice(0,80)}*`] : []),
   '', link].join('\n');
}
