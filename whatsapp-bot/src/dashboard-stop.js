import fs from 'node:fs';
import { lockStatus, processAlive } from './bot-lock.js';
export function botRuntime(lockFile, alive = processAlive) {
 const lock = lockStatus(lockFile, alive);
 return { running: lock.state === 'running', token: lock.token || null };
}
export function requestBotStop({ lockFile, control, alive = processAlive }) {
 const lock = lockStatus(lockFile, alive);
 if (lock.state !== 'running') return { status: 'stopped' };
 if (!lock.token) throw Error('Processo antigo: encerre pelo terminal original.');
 if (!alive(lock.pid) || fs.readFileSync(lockFile, 'utf8').trim() !== lock.raw) throw Error('O processo mudou. Atualize o painel.');
 control.requestStop(lock.token);
 return { status: 'stopping' };
}
