import fs from 'node:fs';
import path from 'node:path';
export class SentStore {
  constructor(file, ttlMs, now = Date.now) {
    this.file = path.resolve(file); this.ttlMs = ttlMs; this.now = now;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    if (!this.data || Array.isArray(this.data) || typeof this.data !== 'object') throw Error('Invalid history');
    for (const row of Object.values(this.data)) if (!Number.isFinite(row?.timestamp)) throw Error('Invalid history entry');
  }
  key(id, group) { return JSON.stringify([String(group), String(id)]); }
  isDealSentToGroup(id, group) {
    const row = this.data[this.key(id, group)] ?? this.data[`${group}:${id}`];
    return Boolean(row && this.now() - row.timestamp < this.ttlMs);
  }
  write() {
    const tmp = this.file + '.tmp';
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(this.data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
  }
  record(id, group, status) {
    this.data[this.key(id, group)] = { timestamp: this.now(), status }; this.write();
  }
  reserve(id, group) { this.record(id, group, 'pending'); }
  markDealAsSent(id, group) { this.record(id, group, 'sent'); }
  prune() {
    for (const [key, row] of Object.entries(this.data)) if (this.now() - row.timestamp >= this.ttlMs) delete this.data[key];
    this.write();
  }
}
