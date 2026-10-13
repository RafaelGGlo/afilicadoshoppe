import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createInstagram } from '../src/instagram.js';
import { promotionalImage } from '../src/instagram-image.js';
import { captureInstagramOffers, instagramProductKey } from '../src/instagram-catalog.js';
import { startDashboard } from '../src/dashboard-server.js';

const deal = { id:'shopee:1:2', title:'Fone <novo>', price:50, previousPrice:100, affiliateUrl:'https://shopee.com.br/product/1/2', imageUrl:'https://example.com/photo.jpg' };
function fixture(t, options = {}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'instagram-test-')); let time=Date.parse('2026-10-12T10:00:00-03:00'), calls=[];
 const cfg = { file:path.join(dir,'ig.sqlite'), mediaDir:path.join(dir,'media'), getOffers:()=>[deal,{...deal,id:'ml:3',title:'Outra oferta'}], now:()=>time,
  makeImage:async()=>Buffer.from('mock jpg'), request:async(...args)=>{ calls.push(args); throw Error('Unexpected network'); }, env:{}, ...options };
 const service=createInstagram(cfg);
 t.after(async()=>{ await service.close(); fs.rmSync(dir,{recursive:true,force:true}); });
 return { service, cfg, calls, advance:ms=>{time+=ms;}, body:{offerId:deal.id,format:'feed',at:'2026-10-12T12:00:00-03:00',caption:'Oferta #afiliado'} };
}
test('Instagram: create, preview, edit, reschedule and cancel persist without network calls',async t=>{
 const f=fixture(t), p=await f.service.save(f.body);
 assert.equal(p.status,'scheduled'); assert.equal(p.mode,'manual'); assert.equal(p.snapshot.title,deal.title);
 assert.equal(f.service.test(p.id).published,false); assert.equal(f.calls.length,0);
 const edited=await f.service.save({...f.body,at:'2026-10-13T14:00:00-03:00',caption:'Alterada'},p.id);
 assert.equal(edited.at,'2026-10-13T17:00:00.000Z'); assert.equal(edited.caption,'Alterada');
 assert.equal(f.service.cancel(p.id).status,'cancelled');
 await assert.rejects(()=>f.service.save(f.body,p.id));
 const reopened=createInstagram(f.cfg); assert.equal(reopened.list()[0].status,'cancelled'); await reopened.close();
});
test('Instagram: validation and separate modes fail before creating a post',async t=>{
 const f=fixture(t);
 for (const patch of [{at:'2020-01-01T12:00:00Z'},{at:'2026-10-15T12:00:00'},{offerId:'missing'},{format:'reel'},{caption:''},{caption:'a'.repeat(2201)},{imageKind:'custom-url'}]) await assert.rejects(()=>f.service.save({...f.body,...patch}));
 f.service.configure({manualEnabled:false,autoEnabled:true}); await assert.rejects(()=>f.service.save(f.body));
 assert.equal(f.service.list().length,0); assert.throws(()=>f.service.configure({autoHour:25}));
});
test('Instagram: automatic scheduling is persistent, daily, concurrent-safe and idempotent',async t=>{
 const f=fixture(t); f.service.configure({autoEnabled:true,autoDays:7});
 const results=await Promise.all([f.service.autoSchedule(),f.service.autoSchedule()]);
 assert.equal(results.flatMap(r=>r.created).length,2); assert.equal(f.service.list().length,2);
 assert.equal((await f.service.autoSchedule()).created.length,0);
 assert.ok(f.service.list().every(p=>p.mode==='auto' && p.at.endsWith('15:00:00.000Z')));
 assert.equal(f.calls.length,0);
});
test('Instagram: preview defaults and independent approval gates prevent ALL Meta requests',async t=>{
 const f=fixture(t); const p=await f.service.save(f.body); f.advance(3*3600000);
 f.service.configure({manualPublish:true,autoPublish:true});
 await assert.rejects(()=>f.service.publish(p.id),/bloqueada/); await f.service.tick(); assert.equal(f.calls.length,0);
 f.cfg.env.INSTAGRAM_LIVE_APPROVED='true'; await assert.rejects(()=>f.service.publish(p.id),/bloqueada/);
 assert.equal(f.calls.length,0); assert.equal(f.service.get(p.id).attempted,0);
});
const liveEnv = { INSTAGRAM_TEST_MODE:'false',INSTAGRAM_LIVE_APPROVED:'true',INSTAGRAM_ACCESS_TOKEN:'SECRET_TOKEN',INSTAGRAM_ACCOUNT_ID:'123',INSTAGRAM_API_VERSION:'v25.0',INSTAGRAM_ACCOUNT_TYPE:'BUSINESS',INSTAGRAM_PUBLIC_BASE_URL:'https://media.example.com' };
test('Instagram: official feed flow, bearer token and permanent duplicate protection',async t=>{
 const calls=[], f=fixture(t,{env:{...liveEnv},request:async(url,init)=>{calls.push([url,init]);return {ok:true,json:async()=>url.includes('status_code')?{status_code:'FINISHED'}:{id:url.includes('media_publish')?'987':'456'}};}});
 f.service.configure({manualPublish:true}); const p=await f.service.save(f.body); f.advance(3*3600000);
 assert.equal((await f.service.publish(p.id)).status,'published'); assert.equal(calls.length,3);
 assert.equal(calls[0][1].headers.Authorization,'Bearer SECRET_TOKEN'); assert.ok(!calls[0][0].includes('SECRET_TOKEN'));
 assert.equal(calls[0][1].body.get('caption'),f.body.caption); assert.ok(calls[0][1].body.get('image_url').includes('/instagram-media/'));
 await assert.rejects(()=>f.service.publish(p.id));
 const other=await f.service.save({...f.body,at:'2026-10-13T12:00:00-03:00'}); f.advance(86400000);
 await assert.rejects(()=>f.service.publish(other.id),/Duplicação/); assert.equal(calls.length,3);
 const reopened=createInstagram(f.cfg); const third=await reopened.save({...f.body,at:'2026-10-14T12:00:00-03:00'}); f.advance(86400000);
 await assert.rejects(()=>reopened.publish(third.id),/Duplicação/); await reopened.close(); assert.equal(calls.length,3);
});
test('Instagram: ambiguous timeout persists reservation and never blindly retries',async t=>{
 const f=fixture(t,{env:{...liveEnv}}); f.service.configure({manualPublish:true}); const p=await f.service.save(f.body); f.advance(3*3600000);
 const failed=await f.service.publish(p.id); assert.equal(failed.status,'failed'); assert.equal(failed.attempted,1);
 assert.ok(!failed.error.includes('SECRET_TOKEN')); await assert.rejects(()=>f.service.publish(p.id));
 await f.service.tick(); assert.equal(f.calls.length,1); assert.throws(()=>f.service.cancel(p.id));
});
test('Instagram: Stories use official media_type and block Creator accounts',async t=>{
 const calls=[],f=fixture(t,{env:{...liveEnv},request:async(url,init)=>{calls.push([url,init]); return {ok:true,json:async()=>url.includes('status_code')?{status_code:'FINISHED'}:{id:'456'}};}});
 f.service.configure({manualPublish:true}); const p=await f.service.save({...f.body,format:'story'}); f.advance(3*3600000);
 f.cfg.env.INSTAGRAM_ACCOUNT_TYPE='CREATOR'; await assert.rejects(()=>f.service.publish(p.id),/Business/); assert.equal(calls.length,0);
 f.cfg.env.INSTAGRAM_ACCOUNT_TYPE='BUSINESS'; assert.equal((await f.service.publish(p.id)).status,'published');
 assert.equal(calls[0][1].body.get('media_type'),'STORIES'); assert.equal(calls[0][1].body.has('caption'),false);
});
test('Instagram: auto publication cannot bypass its separate switch',async t=>{
 const f=fixture(t,{env:{...liveEnv}}); f.service.configure({autoEnabled:true,manualPublish:true});
 await f.service.autoSchedule(); f.advance(3*3600000); await f.service.tick(); assert.equal(f.calls.length,0);
});
test('Instagram: generated JPEGs have correct dimensions for feed and Stories',async()=>{
 const image=await sharp({create:{width:100,height:100,channels:3,background:'#ccc'}}).png().toBuffer();
 for(const format of ['feed','story']) for(const kind of ['promotional','product']) {
  const bytes=await promotionalImage(deal,format,image,kind), metadata=await sharp(bytes).metadata();
  assert.equal(metadata.format,'jpeg'); assert.equal(metadata.width,1080); assert.equal(metadata.height,format==='story'?1920:1080);
 }
});
test('Instagram: catalog observer never interrupts the existing bot on disk failure',()=>{
 assert.doesNotThrow(()=>captureInstagramOffers([deal],path.join(os.tmpdir(),'missing-instagram-dir','catalog.json')));
});
test('Instagram: same product keeps one canonical identity across dashboard and bot offers',()=>{
 assert.equal(instagramProductKey({id:'offers:9',productUrl:'https://shopee.com.br/product/1/2?tracking=other'}),'shopee:1:2');
 assert.equal(instagramProductKey({id:'offers:10',productUrl:'https://shopee.com.br/Fone-i.1.2'}),'shopee:1:2');
 assert.equal(instagramProductKey({id:'shopee:1:2'}),'shopee:1:2');
 assert.equal(instagramProductKey({id:'ml-other',productUrl:'https://produto.mercadolivre.com.br/MLB-1234-item'}),'ml:1234');
});
test('Instagram: optional storage failure does not disable the original dashboard',async t=>{
 const f=fixture(t); const server=await startDashboard({port:0,getReport:()=>({activity:[],totals:{}}),instagramOptions:{...f.cfg,file:f.cfg.mediaDir}});t.after(server.stop);
 assert.equal((await fetch(server.url+'/api/report')).status,200);assert.equal((await fetch(server.url+'/')).status,200);
 assert.equal((await fetch(server.url+'/api/instagram')).status,503);
});
test('Instagram: dashboard routes enforce origin/token, expose no credentials and preserve reports',async t=>{
 const f=fixture(t); const server=await startDashboard({port:0,getReport:()=>({activity:[],totals:{},heartbeatAt:Date.now()}),instagramOptions:{...f.cfg,file:':memory:'}}); t.after(server.stop);
 const state=await (await fetch(server.url+'/api/instagram')).json(); assert.equal(state.testMode,true); assert.ok(state.controlToken);
 const url=server.url+'/api/instagram/posts';
 assert.equal((await fetch(url,{method:'POST',body:JSON.stringify(f.body)})).status,403);
 const headers={'Origin':server.url,'X-Control-Token':state.controlToken,'Content-Type':'application/json'};
 const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(f.body)}); assert.equal(response.status,200); const p=await response.json();
 assert.equal((await fetch(server.url+p.previewUrl)).headers.get('content-type'),'image/jpeg');
 assert.equal((await fetch(server.url+'/api/report')).status,200);
 for(const asset of ['/instagram.js','/instagram.css','/app.js','/style.css','/filters.js']) assert.equal((await fetch(server.url+asset)).status,200);
 assert.equal((await fetch(server.url+'/.env')).status,404); assert.equal((await fetch(server.url+'/instagram-media/'+p.media)).status,404);
 assert.ok(!JSON.stringify(state).includes('SECRET_TOKEN'));
});
