import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, lockStatus } from '../src/bot-lock.js';
import { BotControl } from '../src/control.js';
function fixture(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bot-lock-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return { file:path.join(dir,'bot.lock'), dir }; }
test('1. Processo ativo impede outra inicialização e permanece intacto', t => {
 const f=fixture(t); const owner=acquireLock(f.file); assert.equal(lockStatus(f.file).state,'running');
 assert.throws(()=>acquireLock(f.file),/processo ativo/); assert.equal(lockStatus(f.file).token,owner.token);
 assert.ok(!fs.existsSync(f.file+'.guard')); owner.release(); assert.equal(lockStatus(f.file).state,'stopped');
});
test('2. Lock antigo é recuperado somente após duas verificações de processo encerrado', t => {
 const f=fixture(t); fs.writeFileSync(f.file,'1234'); let checks=0;
 const owner=acquireLock(f.file,{alive:()=>{checks++; return false;}}); assert.equal(checks,2); assert.ok(owner.token); owner.release();
 fs.writeFileSync(f.file,'5678'); let changed=0; assert.throws(()=>acquireLock(f.file,{alive:()=>++changed>1}),/mudou/); assert.equal(fs.readFileSync(f.file,'utf8'),'5678');
 fs.writeFileSync(f.file,'corrupt'); assert.throws(()=>acquireLock(f.file),/inválido/); assert.equal(fs.readFileSync(f.file,'utf8'),'corrupt');
});
test('3. Parada solicita encerramento ao dono do lock sem matar processos ou remover outro lock', t => {
 const f=fixture(t); const owner=acquireLock(f.file); const control=new BotControl(path.join(f.dir,'control.json'));
 control.requestStop(owner.token); assert.equal(control.reload().stopToken,owner.token); assert.equal(lockStatus(f.file).state,'running');
 fs.writeFileSync(f.file,JSON.stringify({pid:process.pid,token:'another-owner'})); owner.release(); assert.ok(fs.existsSync(f.file)); assert.equal(lockStatus(f.file).token,'another-owner');
});
