import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lockStatus } from './bot-lock.js';
import { BotControl } from './control.js';
const root = fileURLToPath(new URL('../', import.meta.url)); process.chdir(root);
const command = process.argv[2], lock = './bot.lock';
try {
 const status = lockStatus(lock);
 if (command === 'status') console.log(status.state === 'running' ? `Bot ativo, PID ${status.pid}.` : status.state === 'stale' ? 'Bot parado. Lock antigo será verificado e recuperado na próxima inicialização.' : 'Bot parado.');
 else if (command === 'start') {
  if (status.state === 'running') throw Error('O bot já está ativo.');
  const out = fs.openSync('./bot-output.log','a',0o600), err = fs.openSync('./bot-error.log','a',0o600);
  const child = spawn(process.execPath, [path.join(root,'src/index.js')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore',out,err] });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; }); child.unref(); fs.closeSync(out); fs.closeSync(err);
  let found;
  for(let i=0;i<50;i++) { await new Promise(resolve => setTimeout(resolve,200)); found=lockStatus(lock); if(found.state==='running' && found.pid===child.pid) break; }
  if(found?.state !== 'running' || found.pid !== child.pid) throw Error('O bot não iniciou. Consulte bot-error.log.');
  console.log(`Bot iniciado em segundo plano, PID ${child.pid}. Logs: bot-output.log e bot-error.log.`);
 } else if (command === 'stop') {
  if(status.state !== 'running') console.log('Bot já está parado.');
  else {
   if(!status.token) throw Error('Este processo usa um lock antigo. Pare pelo terminal original para evitar encerrar outro processo.');
   const control = new BotControl('./bot_control.json'); control.requestStop(status.token);
   let stopped=false;
   for(let i=0;i<300;i++) { await new Promise(resolve => setTimeout(resolve,200)); const current=lockStatus(lock); if(current.state !== 'running' || current.token !== status.token) { stopped=true; break; } }
   if(!stopped) throw Error('Parada solicitada, mas o processo ainda está encerrando. Consulte o status; nenhum processo foi forçado a terminar.');
   console.log('Bot encerrado.');
  }
 } else throw Error('Use start, stop ou status.');
} catch(error) { console.error(error.message); process.exitCode=1; }
