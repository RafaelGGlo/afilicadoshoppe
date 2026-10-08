import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_OFFER_FILTERS, validateOfferFilters, matchesOfferFilters, filterActivity } from '../dashboard/filters.js';
import { BotControl } from '../src/control.js';
import { createShopeeSource } from '../src/shopee-offers.js';
test('1. Filtros combinados das ofertas são persistidos e inválidos não alteram a configuração',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'offer-filters-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const control=new BotControl(path.join(dir,'control.json'));
 const filters=validateOfferFilters({minPrice:20,maxPrice:100,minDiscount:30,minSales:500,categories:[100535],includeKeywords:'fone, café',excludeKeywords:'capa, usado'});
 control.update({offerFilters:filters}); assert.deepEqual(new BotControl(control.file).data.offerFilters,filters);
 const deal={title:'Fone JBL NOVO',price:51,discountRate:35,sales:500,categoryIds:[100535]};assert.equal(matchesOfferFilters(deal,filters),true);
 for(const patch of [{price:10},{price:101},{discountRate:29},{sales:499},{categoryIds:[999]},{title:'Fone usado'},{title:'TeleFONE'},{sales:undefined},{discountRate:undefined}])assert.equal(matchesOfferFilters({...deal,...patch},filters),false);
 assert.equal(matchesOfferFilters({...deal,title:'CAFÉ especial'},filters),true);
 const before=fs.readFileSync(control.file,'utf8');for(const offerFilters of [{minPrice:50,maxPrice:10},{minDiscount:100},{minSales:-1},{categories:['100535']},{includeKeywords:123},{unknown:1},null])assert.throws(()=>control.update({offerFilters}));assert.equal(fs.readFileSync(control.file,'utf8'),before);
 control.update({offerFilters:DEFAULT_OFFER_FILTERS});assert.equal(matchesOfferFilters({...deal,title:'Outro produto',sales:undefined,discountRate:undefined},control.data.offerFilters),true);
});
test('2. Busca ultrapassa ofertas fora dos filtros e encontra outra sem travar na primeira página',async()=>{
 const nodes=[['Fone barato',10],['Fone usado',51],['Fone JBL',51],['Carregador USB',51]].map(([productName,priceMin],index)=>({itemId:index+1,shopId:99,productName,priceMin,priceMax:priceMin,priceDiscountRate:35,sales:600,productCatIds:[100535],productLink:'https://shopee.com.br/product/99/'+(index+1),offerLink:'https://s.shopee.com.br/abc',imageUrl:'https://example.com/image.jpg'}));
 const source=createShopeeSource({env:{SHOPEE_APP_ID:'test',SHOPEE_SECRET:'test',SHOPEE_OFFER_MODE:'discount-only'},request:async()=>({ok:true,json:async()=>({data:{productOfferV2:{nodes,pageInfo:{hasNextPage:false}}}})})});
 let filters=validateOfferFilters({minPrice:20,includeKeywords:'fone',excludeKeywords:'usado'}),stats;
 const selected=await source({limit:1,matchesExtraFilters:deal=>matchesOfferFilters(deal,filters),onSearchSummary:summary=>{stats=summary;}});assert.equal(selected[0].title,'Fone JBL');assert.equal(stats.filtered,2);assert.equal(stats.valid,1);
 filters=validateOfferFilters({includeKeywords:'carregador'});const next=await source({limit:1,matchesExtraFilters:deal=>matchesOfferFilters(deal,filters)});assert.equal(next[0].title,'Carregador USB');
});
test('3. Histórico combina resultado, período, grupo, valores, texto e ordenação sem alterar as ofertas',()=>{
 const now=Date.parse('2026-10-08T04:00:00Z');
 const entries=[{title:'CAFÉ',dealId:'a',at:now-1000,price:51,group:1,type:'sent'},{title:'Fone JBL',dealId:'b',at:now-2000,price:30,group:2,type:'send_failed',reason:'SEND_TIMEOUT'},{title:'Fone JBL',dealId:'c',at:now-86400000,price:60,group:2,type:'send_failed',reason:'SEND_FAILURE'},{title:'Falha',dealId:'d',at:now-3000,price:null,group:null,type:'preparation_failed'},{title:'Fone',dealId:'e',at:now-7200000,price:80,group:1,type:'sent'}];const before=JSON.stringify(entries);
 assert.deepEqual(filterActivity(entries,{query:'cafe',status:'sent',period:'today',group:'1',minPrice:50,maxPrice:52},{now}).map(x=>x.dealId),['a']);
 assert.deepEqual(filterActivity(entries,{query:'fone',status:'timeout',group:'2',period:'24h'},{now}).map(x=>x.dealId),['b']);
 assert.deepEqual(filterActivity(entries,{status:'failure',period:'7d'},{now}).map(x=>x.dealId),['c']);
 assert.deepEqual(filterActivity(entries,{from:now-3000,until:now-1000,sort:'oldest'},{now}).map(x=>x.dealId),['d','b','a']);
 assert.deepEqual(filterActivity(entries,{minPrice:0,sort:'price_low'},{now}).map(x=>x.dealId),['b','a','c','e']);
 assert.equal(filterActivity(entries,{period:'today'},{now,timezone:'America/Sao_Paulo'}).some(x=>x.dealId==='e'),false);assert.equal(filterActivity(entries,{group:'none'},{now})[0].dealId,'d');assert.equal(filterActivity(entries,{}, {now}).length,entries.length);assert.equal(JSON.stringify(entries),before);
});
