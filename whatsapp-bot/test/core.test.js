import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SentStore } from '../src/store.js';
import { createBroadcaster } from '../src/broadcast.js';
import { affiliateLink } from '../src/affiliates.js';
import { downloadImage } from '../src/media.js';
import { formatDeal } from '../src/format.js';
function history(t, ttl = 1000, now = Date.now) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deals-'));
 t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
 return new SentStore(path.join(dir, 'history.json'), ttl, now);
}
test('test deals work without API and clearly disclose fictitious content', async () => {
 const deal = { platform: 'shopee', testOnly: true, title: 'Teste', price: 49.9, productUrl: 'https://shopee.com.br/' };
 const link = await affiliateLink(deal, {}, () => { throw Error('Test must not call API'); });
 const caption = formatDeal(deal, link);
 assert.match(caption, /NÃO É UMA OFERTA REAL/);
 assert.match(caption, /Preço fictício/);
 assert.doesNotMatch(caption, /Compre aqui|posso receber comissão/);
 await assert.rejects(affiliateLink({ ...deal, testOnly: false }, {}));
 await assert.rejects(affiliateLink({ ...deal, productUrl: 'https://example.com/' }, {}));
});
test('dedup survives restart, isolates groups and expires at boundary', t => {
 let time = 100; const s = history(t, 1000, () => time);
 s.markDealAsSent('product','A');
 const reopened = new SentStore(s.file,1000,()=>time);
 assert.equal(reopened.isDealSentToGroup('product','A'),true);
 assert.equal(reopened.isDealSentToGroup('product','B'),false);
 time = 1100; assert.equal(reopened.isDealSentToGroup('product','A'),false);
});
test('corrupt history fails closed', t => {
 const s = history(t); fs.writeFileSync(s.file,'{');
 assert.throws(() => new SentStore(s.file,1000));
});
test('one failing group does not abort; caption and image combined; retries suppressed', async t => {
 let time = 0; const s = history(t,100000,()=>time), calls = [], waits = [];
 const send = createBroadcaster({store:s,groups:['A','B','C'],minMs:5,maxMs:5,now:()=>time,
  sleep: async ms=>{waits.push(ms); time+=ms;},logger:{info(){},warn(){}},
  getSocket:()=>({sendMessage:async(g,payload)=>{calls.push([g,payload]);if(g==='A')throw Error('fail');}})});
 await send({id:'p'},Buffer.from('image'),'caption');
 await send({id:'p'},Buffer.from('image'),'caption');
 assert.equal(calls.length,3); assert.deepEqual(waits,[0,5,5]);
 for(const [,payload] of calls){assert.equal(payload.caption,'caption');assert.ok(Buffer.isBuffer(payload.image));assert.equal('text' in payload,false);}
 assert.equal(s.data[s.key('p','A')].status,'pending');
 assert.equal(s.data[s.key('p','B')].status,'sent');
});
test('disk failure prevents any network send',async t=>{
 const s=history(t);s.write=()=>{throw Error('disk');};let count=0;
 const send=createBroadcaster({store:s,groups:['A'],minMs:1,maxMs:1,getSocket:()=>({sendMessage:()=>count++}),logger:{},sleep:async()=>{}});
 await assert.rejects(send({id:'p'},Buffer.alloc(1),'caption'));assert.equal(count,0);
});
test('ML never fabricates tracking tags',async()=>{
 await assert.rejects(affiliateLink({platform:'ml',productUrl:'https://mercadolivre.com.br/x'},{AFFILIATE_TAG_ML:'tag'}));
 assert.equal(await affiliateLink({platform:'ml',affiliateUrl:'https://mercadolivre.com/sec/abc'}),'https://mercadolivre.com/sec/abc');
 await assert.rejects(affiliateLink({platform:'ml',affiliateUrl:'https://mercadolivre.com.evil.com/sec/abc'}));
});
test('Shopee signs exact body and preserves returned link',async()=>{
 const request=async(url,options)=>{
  assert.equal(url,'https://open-api.affiliate.shopee.com.br/graphql');
  assert.match(options.headers.Authorization,/^SHA256 Credential=app, Timestamp=\d+, Signature=[a-f0-9]{64}$/);
  assert.match(JSON.parse(options.body).query,/generateShortLink\(input:/);
  return {ok:true,json:async()=>({data:{generateShortLink:{shortLink:'https://s.shopee.com.br/abc'}}})};
 };
 assert.equal(await affiliateLink({platform:'shopee',productUrl:'https://shopee.com.br/product'}, {SHOPEE_APP_ID:'app',SHOPEE_SECRET:'secret'},request),'https://s.shopee.com.br/abc');
});
test('dead image and fake image bytes rejected',async()=>{
 await assert.rejects(downloadImage('https://example.com/x',async()=>({ok:false,headers:new Headers()})));
 await assert.rejects(downloadImage('https://example.com/x',async()=>new Response('html',{headers:{'content-type':'image/jpeg'}})));
});
test('format handles price and coupon without accidental WhatsApp markup',()=>{
 const result=formatDeal({platform:'ml',title:'*Product*',price:54.99,oldPrice:60,coupon:'ABC'},'https://mercadolivre.com/sec/x');
 assert.match(result,/54,99/);assert.match(result,/Cupom: \*ABC\*/);
 assert.match(result,/^\*Product\*\n\nDe ~R\$\s*60,00~ por \*R\$\s*54,99\*/);
 assert.ok(result.endsWith('\n\nhttps://mercadolivre.com/sec/x'));
 assert.doesNotMatch(result,/Preço e disponibilidade|Link de afiliado|posso receber comissão|Compre aqui/);
 assert.throws(()=>formatDeal({title:'x',price:NaN},'x'));
});

test('caption omits campaign headline and keeps minimum price without inventing a former price', () => {
 const result = formatDeal({ platform: 'shopee', headline: 'RADAR SHOPP', title: 'Fone Bluetooth', price: 38, fromPrice: true }, 'https://s.shopee.com.br/abc');
 assert.match(result, /^\*Fone Bluetooth\*\n\nMenor preço:/);
 assert.doesNotMatch(result, /A partir de|De ~|comissão/);
});
