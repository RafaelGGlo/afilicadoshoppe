import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';

export class SendPacing {
 constructor(file, { minMs = 600000, maxMs = 900000, now = Date.now, chooseInterval = randomInt } = {}) {
  if (!Number.isSafeInteger(minMs) || !Number.isSafeInteger(maxMs) || minMs < 1 || maxMs < minMs) throw Error('Invalid send interval');
  this.file = path.resolve(file);
  this.minMs = minMs; this.maxMs = maxMs; this.now = now; this.chooseInterval = chooseInterval;
  fs.mkdirSync(path.dirname(this.file), { recursive: true });
  if (fs.existsSync(this.file)) {
   const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
   if (!Number.isSafeInteger(state?.nextAllowedAt) || state.nextAllowedAt < 0) throw Error('Invalid send schedule');
   this.nextAllowedAt = state.nextAllowedAt;
  } else {
   this.nextAllowedAt = now() + this.interval();
   this.write();
  }
 }
 interval() {
  const interval = this.chooseInterval(this.minMs, this.maxMs + 1);
  if (!Number.isSafeInteger(interval) || interval < this.minMs || interval > this.maxMs) throw Error('Invalid selected send interval');
  return interval;
 }
 configure(minMs, maxMs) {
  if (!Number.isSafeInteger(minMs) || !Number.isSafeInteger(maxMs) || minMs < 60000 || maxMs < minMs || maxMs > 86400000) throw Error('Invalid send interval');
  if (minMs === this.minMs && maxMs === this.maxMs) return;
  const previous = { minMs: this.minMs, maxMs: this.maxMs, nextAllowedAt: this.nextAllowedAt };
  this.minMs = minMs; this.maxMs = maxMs;
  try { this.nextAllowedAt = Math.max(this.nextAllowedAt, this.now() + this.interval()); this.write(); }
  catch (error) { Object.assign(this, previous); throw error; }
 }
 canSend() { return this.now() >= this.nextAllowedAt; }
 claim() {
  if (!this.canSend()) return false;
  // Save before attempting network delivery, preserving pacing after crashes.
  this.nextAllowedAt = this.now() + this.interval();
  this.write();
  return true;
 }
 write() {
  const temporary = this.file + '.tmp';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ nextAllowedAt: this.nextAllowedAt }) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, this.file);
 }
}
