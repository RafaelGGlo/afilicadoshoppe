import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Small DOM adapter, matching the existing project's dependency-free UI tests.
function dom() {
 const ids=new Map();
 class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.value='';this.disabled=false;this.open=false;this.textContent='';}
  append(...elements){this.children.push(...elements);}
  after(element){this.sibling=element;}
  replaceChildren(...elements){this.children=elements;}
  setAttribute(key,value){this[key]=value;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  querySelector(){return {disabled:false};}
  set innerHTML(html){for(const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)){
   const element=new Element(match[1]); ids.set(match[2],element);
   if(match[0].includes('type="checkbox"')) element.checked=false;
  }}
 }
 ids.set('activity',new Element()); const nav=new Element('nav');
 return { ids, nav, Element, document:{getElementById:id=>ids.get(id),createElement:tag=>new Element(tag),querySelector:selector=>selector==='nav'?nav:null,activeElement:null} };
}
async function calendar() {
 const ui=dom(), calls=[], state={testMode:true,credentialsConfigured:false,storiesSupported:true,controlToken:'TOKEN',settings:{manualEnabled:true,autoEnabled:false,manualPublish:false,autoPublish:false,autoHour:12,autoMinute:0,autoDays:7,autoFormat:'feed'},offers:[{id:'1',title:'Fone <script>',price:50,affiliateUrl:'https://shopee.com.br/product/1/2'}],posts:[]};
 const fetch=async(url,init)=>{
  calls.push({url,...init}); let value=state;
  if(init.method==='POST' && url==='/api/instagram/posts'){
   const b=JSON.parse(init.body); value={id:'post-id',offer_id:b.offerId,at:new Date(b.at).toISOString(),caption:b.caption,format:b.format,mode:'manual',status:'scheduled',attempted:0,previewUrl:'/preview.jpg',snapshot:{title:state.offers[0].title,imageKind:b.imageKind}}; state.posts.push(value);
  }else if(init.method==='PUT'){
   const b=JSON.parse(init.body); Object.assign(state.posts[0],{at:new Date(b.at).toISOString(),caption:b.caption});value=state.posts[0];
  }else if(url.endsWith('/test')) value={message:'Prévia validada localmente. Nenhuma chamada à Meta foi realizada.'};
  else if(url.endsWith('/cancel')) {state.posts[0].status='cancelled';value=state.posts[0];}
  else if(url.endsWith('/settings')) {Object.assign(state.settings,JSON.parse(init.body));}
  else if(url.endsWith('/auto')) value={created:[]};
  return {ok:true,json:async()=>structuredClone(value)};
 };
 const source=fs.readFileSync(new URL('../dashboard/instagram.js',import.meta.url),'utf8');
 const context=vm.createContext({document:ui.document,fetch,Date,Intl,AbortSignal,console,setInterval:()=>0});
 await vm.runInContext('(async()=>{'+source+'})()',context);
 return {...ui,calls,state,$:id=>ui.ids.get('ig-'+id)};
}
test('Instagram calendar: month/week navigation, date selection and safe offer text',async()=>{
 const c=await calendar(); assert.equal(c.$('calendar').children.length,49);
 assert.equal(c.nav.children.at(-1).textContent,'Instagram'); assert.match(c.$('mode').textContent,/TESTE/);
 c.$('view').value='week'; c.$('view').onchange(); assert.equal(c.$('calendar').children.length,14);
 const previous=c.$('period').textContent;c.$('next').onclick();assert.notEqual(c.$('period').textContent,previous);c.$('prev').onclick();assert.equal(c.$('period').textContent,previous);
 c.$('calendar').children[7].children[0].onclick(); assert.equal(c.$('dialog').open,true); assert.match(c.$('at').value,/T12:00$/);
 assert.match(c.$('offer').children[0].textContent,/<script>/); assert.equal(c.$('offer').children[0].children.length,0);
 c.$('close').onclick();assert.equal(c.$('dialog').open,false);
});
test('Instagram calendar: manual save, preview, test, reschedule and cancellation',async()=>{
 const c=await calendar(); c.$('new').onclick();c.$('at').value='2026-12-15T14:30';
 await c.$('post-form').onsubmit({preventDefault(){}});
 assert.equal(c.state.posts.length,1);assert.equal(c.state.posts[0].at,'2026-12-15T17:30:00.000Z');
 assert.equal(c.$('preview').hidden,false);assert.match(c.$('preview').src,/preview.jpg/);
 await c.$('test').onclick();assert.match(c.$('editor-message').textContent,/Nenhuma chamada/);
 c.$('at').value='2026-12-16T15:00';c.$('caption').value='Editada';await c.$('post-form').onsubmit({preventDefault(){}});
 assert.equal(c.state.posts[0].caption,'Editada');assert.equal(c.state.posts[0].at,'2026-12-16T18:00:00.000Z');
 await c.$('cancel').onclick();assert.equal(c.state.posts[0].status,'cancelled');assert.equal(c.$('dialog').open,false);
 assert.ok(!c.calls.some(call=>call.url.endsWith('/publish')));
 assert.ok(c.calls.filter(call=>call.method!=='GET').every(call=>call.headers['X-Control-Token']==='TOKEN'));
});
test('Instagram calendar: modes saved independently and automatic fill remains a scheduling action',async()=>{
 const c=await calendar();c.$('autoEnabled').checked=true;c.$('manualPublish').checked=false;c.$('autoPublish').checked=false;
 await c.$('settings-form').onsubmit({preventDefault(){}});assert.equal(c.state.settings.autoEnabled,true);assert.equal(c.state.settings.manualEnabled,true);
 await c.$('auto').onclick();assert.match(c.$('message').textContent,/0 posts agendados/);assert.ok(!c.calls.some(call=>call.url.endsWith('/publish')));
});
test('Instagram calendar: requested manual interface is inside activity with October 15 at noon',async()=>{
 const c=await calendar();
 assert.equal(c.ids.get('activity').children.at(-1).id,'instagram');
 c.$('request').onclick();
 assert.equal(c.$('dialog').open,true);
 assert.equal(c.$('at').value,'2026-10-15T12:00');
 assert.equal(c.$('editor-mode').textContent,'Modo: manual');
 assert.equal(c.state.posts.length,0);
 assert.ok(!c.calls.some(call=>call.method!=='GET'));
 await c.$('post-form').onsubmit({preventDefault(){}});
 assert.equal(c.state.posts[0].mode,'manual');
 assert.equal(c.state.posts[0].at,'2026-10-15T15:00:00.000Z');
});
