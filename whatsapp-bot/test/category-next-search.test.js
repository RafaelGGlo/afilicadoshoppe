import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_OFFER_FILTERS, CATEGORY_CHOICES, categoryChoice, validateOfferFilters, matchesOfferFilters } from '../dashboard/filters.js';
import { snapshotOfferFilters } from '../src/search-snapshot.js';
import { createShopeeSource } from '../src/shopee-offers.js';
import { BotControl } from '../src/control.js';
const env={SHOPEE_APP_ID:'test',SHOPEE_SECRET:'test',SHOPEE_OFFER_MODE:'discount-only'};
const product=(id,title,category=100535)=>({itemId:id,shopId:99,productName:title,priceMin:51,priceMax:51,priceDiscountRate:35,sales:50,productCatIds:[category],productLink:'https://shopee.com.br/product/99/'+id,offerLink:'https://s.shopee.com.br/abc',imageUrl:'https://example.com/image.jpg'});
const response=(nodes,hasNextPage=false)=>({ok:true,json:async()=>({data:{productOfferV2:{nodes,pageInfo:{hasNextPage}}}})});
test('1. Trocar categoria durante a consulta preserva o ciclo atual e aplica a seleção na próxima busca',async()=>{
 let filters=validateOfferFilters({categories:[100535]}),finish,query;
 const currentFilters=snapshotOfferFilters(filters);
 const source=createShopeeSource({env:{...env,SHOPEE_CATEGORY_IDS:'100535'},request:async(url,options)=>{query=JSON.parse(options.body).query;return new Promise(resolve=>{finish=resolve;});}});
 const current=source({matchesExtraFilters:deal=>matchesOfferFilters(deal,currentFilters)});
 filters=validateOfferFilters({categories:[100013]});finish(response([product(1,'Fone JBL')]));
 assert.match(query,/productCatId: 100535/);assert.equal((await current)[0].title,'Fone JBL');assert.deepEqual(currentFilters.categories,[100535]);
 const nextFilters=snapshotOfferFilters(filters);const next=createShopeeSource({env:{...env,SHOPEE_CATEGORY_IDS:filters.categories.join(',')},request:async(url,options)=>{assert.match(JSON.parse(options.body).query,/productCatId: 100013/);return response([product(2,'Celular Samsung',100013)]);}});
 assert.equal((await next({matchesExtraFilters:deal=>matchesOfferFilters(deal,nextFilters)}))[0].title,'Celular Samsung');assert.throws(()=>currentFilters.categories.push(100013));
});
test('2. TUDO embaralha resultados sem restringir categoria e avança pelas páginas sem alterar a resposta da API',async()=>{
 const nodes=[product(1,'Fone A'),product(2,'Fone B'),product(3,'Fone C')];const queries=[];
 const source=createShopeeSource({env,randomize:true,pickIndex:()=>0,request:async(url,options)=>{queries.push(JSON.parse(options.body).query);return response(nodes,queries.length===1);}});
 const one=await source({limit:1});const two=await source({limit:1});
 assert.equal(one[0].title,'Fone B');assert.equal(two[0].title,'Fone B');assert.match(queries[0],/page: 1/);assert.match(queries[1],/page: 2/);assert.ok(queries.every(query=>!query.includes('productCatId:')));assert.deepEqual(nodes.map(node=>node.productName),['Fone A','Fone B','Fone C']);
});
test('3. TUDO e categorias são persistidos sem mudar intervalo, pausa ou outros filtros',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'category-selection-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const control=new BotControl(path.join(dir,'control.json'));
 control.update({paused:true,minMinutes:12,maxMinutes:15,offerFilters:{...DEFAULT_OFFER_FILTERS,minPrice:20}});
 const choice=CATEGORY_CHOICES.find(item=>item.key==='phones');control.update({offerFilters:{...control.data.offerFilters,categories:choice.ids}});
 const saved=new BotControl(control.file);assert.equal(categoryChoice(saved.data.offerFilters.categories).key,'phones');assert.equal(saved.data.offerFilters.minPrice,20);assert.equal(saved.data.minMinutes,12);assert.equal(saved.data.paused,true);
 saved.update({offerFilters:{...saved.data.offerFilters,categories:[]}});assert.equal(categoryChoice(saved.reload().offerFilters.categories).key,'all');assert.equal(saved.data.offerFilters.minPrice,20);assert.equal(categoryChoice([100635,100634,100644,100013,100535]).key,'electronics');
});
