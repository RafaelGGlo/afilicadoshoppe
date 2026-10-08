import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BotControl } from '../src/control.js';
import { SendPacing } from '../src/send-pacing.js';
import { startDashboard } from '../src/dashboard-server.js';
import { emptyReport } from '../src/report.js';
import { SentStore } from '../src/store.js';
import { createBroadcaster } from '../src/broadcast.js';
function fixture(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'control-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return {dir,control:new BotControl(path.join(dir,'control.json'))}; }
test('1. Pausa persistente bloqueia novas tentativas e retomada respeita a janela de envio',async t=>{
 const f=fixture(t); let time=0,calls=0; const pacing=new SendPacing(path.join(f.dir,'schedule.json'),{now:()=>time,chooseInterval:min=>min}); const due=pacing.canSend.bind(pacing); pacing.canSend=()=>!f.control.data.paused&&due();
 const send=createBroadcaster({store:new SentStore(path.join(f.dir,'sent.json'),86400000,()=>time),groups:['A'],minMs:1,maxMs:1,pacing,now:()=>time,sleep:async()=>{},getSocket:()=>({sendMessage:async()=>{calls++;}}),logger:{info(){},warn(){}}});
 f.control.update({paused:true}); time=600000; await send({id:'a'},Buffer.from('x'),'x'); assert.equal(calls,0);
 assert.equal(new BotControl(f.control.file).data.paused,true); f.control.update({paused:false}); await send({id:'a'},Buffer.from('x'),'x'); assert.equal(calls,1); assert.equal(pacing.nextAllowedAt,1200000);
});
test('2. Intervalo alterado é persistido sem antecipar um prazo já reservado; valores inválidos são recusados',t=>{
 const f=fixture(t); const pacing=new SendPacing(path.join(f.dir,'schedule.json'),{now:()=>0,chooseInterval:min=>min});
 f.control.update({minMinutes:20,maxMinutes:25}); pacing.configure(1200000,1500000); assert.equal(pacing.nextAllowedAt,1200000);
 f.control.update({minMinutes:1,maxMinutes:2}); pacing.configure(60000,120000); assert.equal(pacing.nextAllowedAt,1200000); assert.equal(new BotControl(f.control.file).data.minMinutes,1);
 const previous=fs.readFileSync(f.control.file,'utf8'); for(const patch of [{minMinutes:0},{minMinutes:3,maxMinutes:2},{maxMinutes:1441},{paused:'yes'},{stopToken:'bad'}]) assert.throws(()=>f.control.update(patch)); assert.equal(fs.readFileSync(f.control.file,'utf8'),previous);
});
test('3. Controles HTTP exigem origem local e token; leitura e pausas funcionam sem expor arquivos privados',async t=>{
 const f=fixture(t); const server=await startDashboard({port:0,getReport:()=>({...emptyReport(),control:f.control.reload()}),onControl:patch=>f.control.update(patch)}); t.after(server.stop);
 const data=await (await fetch(server.url+'/api/report')).json(); assert.equal(data.controlsEnabled,true);
 const post=(patch,headers={})=>fetch(server.url+'/api/control',{method:'POST',headers:{'Content-Type':'application/json',Origin:server.url,'X-Control-Token':data.controlToken,...headers},body:JSON.stringify(patch)});
 assert.equal((await post({paused:true},{'X-Control-Token':''})).status,403); assert.equal((await post({paused:true},{Origin:'https://external.example'})).status,403);
 assert.equal((await post({paused:true})).status,200); assert.equal(f.control.reload().paused,true);
 assert.equal((await post({minMinutes:20,maxMinutes:25})).status,200); assert.equal(f.control.reload().minMinutes,20);
 assert.equal((await post({minMinutes:0})).status,400); assert.equal((await fetch(server.url+'/.env')).status,404);
 assert.equal((await post({paused:false})).status,200); assert.equal(f.control.reload().paused,false);
});
