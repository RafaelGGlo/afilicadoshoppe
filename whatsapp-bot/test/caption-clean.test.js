import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDeal, shortTitle } from '../src/format.js';
import { prepareOffer } from '../src/offer-preparation.js';
const link = 'https://s.shopee.com.br/abc?x=1&y=2';
test('1. Legenda real remove cabeçalho e emojis, destaca produto e mantém preço e link', async () => {
 const { caption } = await prepareOffer({ id:'test', title:'Fone Bluetooth JBL', price:51, headline:'🔎⚡ GARIMPO DE OFERTAS' }, { cooldown:{defer(){assert.fail();}}, headline:'🔎⚡ GARIMPO DE OFERTAS', createLink:async()=>link, fetchImage:async()=>Buffer.from('image') });
 assert.equal(caption, '*Fone Bluetooth JBL*\n\nPor *R$\u00a051,00*\n\n'+link);
 assert.doesNotMatch(caption,/GARIMPO|🔎|⚡|🔥|comissão|disponibilidade/);
});
test('2. Nome longo é encurtado sem inventar características nem quebrar a formatação', () => {
 const original='*Smartphone Samsung Galaxy A16 128GB 4GB RAM*\n Tela AMOLED 6.7 polegadas câmera 50MP bateria 5000mAh Dual SIM carregador USB-C proteção e acessórios completos para uso diário';
 const title=shortTitle(original); assert.ok(Array.from(title).length<=120); assert.ok(title.endsWith('…')); assert.ok(title.startsWith('Smartphone Samsung Galaxy A16 128GB 4GB RAM'));
 const caption=formatDeal({title:original,price:899},link); assert.equal(caption.split('\n')[0],'*'+title+'*'); assert.equal((caption.split('\n')[0].match(/\*/g)||[]).length,2);
 assert.equal(shortTitle('Fone JBL - Frete grátis compre agora'),'Fone JBL'); assert.ok(caption.endsWith(link));
});
test('3. Preço anterior, cupom e menor preço permanecem corretos sem alegar Pix nem desconto inventado', () => {
 const caption=formatDeal({title:'Pasta de Amendoim Dr. Peanut Cookies & Cream 600g',price:38,oldPrice:78,coupon:'*ABC*'},link);
 assert.match(caption,/De ~R\$\s*78,00~ por \*R\$\s*38,00\*/); assert.match(caption,/Cupom: \*ABC\*/); assert.doesNotMatch(caption,/Pix|🔥|🎟/);
 const minimum=formatDeal({title:'Fone',price:51,oldPrice:157,fromPrice:true},link); assert.match(minimum,/Menor preço:/); assert.doesNotMatch(minimum,/De |A partir de/);
 const test=formatDeal({testOnly:true,title:'Teste',price:1},link); assert.match(test,/NÃO É UMA OFERTA REAL/);
});
