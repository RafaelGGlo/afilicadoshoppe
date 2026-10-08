import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
export function processAlive(pid) {
 try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
export function lockStatus(file, alive = processAlive) {
 if (!fs.existsSync(file)) return { state: 'stopped' };
 const raw = fs.readFileSync(file, 'utf8').trim(); let record;
 try { record = JSON.parse(raw); } catch { throw Error('Lock inválido: inspecione antes de remover.'); }
 if (typeof record === 'number') record = { pid: record, token: null };
 if (!Number.isSafeInteger(record?.pid) || record.pid < 1) throw Error('Lock inválido: inspecione antes de remover.');
 return { ...record, state: alive(record.pid) ? 'running' : 'stale', raw };
}
export function acquireLock(file, { pid = process.pid, alive = processAlive } = {}) {
 const guard = file + '.guard';
 fs.mkdirSync(guard);
 try {
 const old = lockStatus(file, alive);
 if (old.state === 'running') throw Error('Já existe um processo ativo associado ao bot.lock.');
 if (old.state === 'stale') {
  if (alive(old.pid) || fs.readFileSync(file, 'utf8').trim() !== old.raw) throw Error('O lock mudou durante a verificação.');
  fs.unlinkSync(file);
 }
 const record = { pid, token: randomUUID(), startedAt: Date.now() };
 const descriptor = fs.openSync(file, 'wx', 0o600);
 try { fs.writeFileSync(descriptor, JSON.stringify(record)); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
 return { ...record, release() {
  if (!fs.existsSync(file)) return;
  try { if (JSON.parse(fs.readFileSync(file, 'utf8')).token === record.token) fs.unlinkSync(file); } catch {}
 } };
 } finally { fs.rmdirSync(guard); }
}
