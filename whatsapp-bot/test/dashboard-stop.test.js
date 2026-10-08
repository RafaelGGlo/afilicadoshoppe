import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock } from '../src/bot-lock.js';
import { BotControl } from '../src/control.js';
import { requestBotStop, botRuntime } from '../src/dashboard-stop.js';
import { startDashboard } from '../src/dashboard-server.js';
import { emptyReport } from '../src/report.js';
function fixture(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'panel-stop-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return {dir,lockFile:path.join(dir,'bot.lock'),control:new BotControl(path.join(dir,'control.json'))}; }
test('1. PARAR solicita apenas o dono atual, preserva pausa/intervalo e não mata o processo',t=>{
 const f=fixture(t),owner=acquireLock(f.lockFile); const before=f.control.reload();
 assert.deepEqual(requestBotStop(f),{status:'stopping'});assert.equal(f.control.reload().stopToken,owner.token);assert.equal(botRuntime(f.lockFile).running,true);
 assert.equal(f.control.data.paused,before.paused);assert.equal(f.control.data.minMinutes,before.minMinutes);owner.release();assert.equal(botRuntime(f.lockFile).running,false);
});
test('2. Bot parado e lock antigo não causam encerramento de outro processo',t=>{
 const f=fixture(t);assert.deepEqual(requestBotStop(f),{status:'stopped'});assert.ok(!fs.existsSync(f.control.file));
 fs.writeFileSync(f.lockFile,'12345');assert.deepEqual(requestBotStop({...f,alive:()=>false}),{status:'stopped'});
 fs.writeFileSync(f.lockFile,String(process.pid));assert.throws(()=>requestBotStop(f),/antigo/);assert.ok(!fs.existsSync(f.control.file));
});
test('3. Botão HTTP exige token e origem, responde antes de encerrar e mantém o painel consultável',async t=>{
 const f=fixture(t),owner=acquireLock(f.lockFile);const server=await startDashboard({port:0,getReport:()=>({...emptyReport(),botRunning:botRuntime(f.lockFile).running}),onStop:()=>requestBotStop(f)});t.after(server.stop);
 const report=await(await fetch(server.url+'/api/report')).json();assert.equal(report.stopEnabled,true);
 const post=headers=>fetch(server.url+'/api/stop',{method:'POST',headers:{'Content-Type':'application/json',Origin:server.url,'X-Control-Token':report.controlToken,...headers},body:'{}'});
 assert.equal((await post({'X-Control-Token':''})).status,403);assert.equal((await post({Origin:'https://other.example'})).status,403);assert.ok(!fs.existsSync(f.control.file));
 const response=await post({});assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'stopping'});assert.equal(f.control.reload().stopToken,owner.token);
 owner.release();assert.equal((await(await fetch(server.url+'/api/report')).json()).botRunning,false);assert.equal((await post({})).status,200);
});
