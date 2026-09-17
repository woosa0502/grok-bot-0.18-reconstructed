import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
export function problem(code, message, statusCode = 409) { return Object.assign(new Error(message), { code, statusCode }); }
export function id(value, name = 'id') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,191}$/.test(value)) throw problem('INVALID_ID', `${name} is invalid`, 400);
  return value;
}
export function boundedText(value, name = 'text', max = 100_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw problem('INVALID_TEXT', `${name} must contain 1..${max} characters`, 400);
  return value.trim();
}

/** Single SQLite transaction is the authority for an accepted request or display event. */
export class Store {
  constructor(file, { readonly = false } = {}) {
    if (!readonly) mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file, { readOnly: readonly });
    this.db.exec('PRAGMA busy_timeout=5000');
    if (!readonly) {
      chmodSync(file, 0o600);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.db.exec(`CREATE TABLE IF NOT EXISTS records (bucket TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(bucket,key));
        CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, bot TEXT NOT NULL, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS events_bot_seq ON events(bot,seq);`);
    }
    this.inTransaction = false;
  }
  transaction(fn) {
    if (this.inTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE'); this.inTransaction = true;
    try { const value = fn(); if (value?.then) throw new Error('Store transactions must be synchronous'); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.inTransaction = false; }
  }
  get(bucket, key) { const row = this.db.prepare('SELECT value FROM records WHERE bucket=? AND key=?').get(bucket,key); return row ? JSON.parse(row.value) : null; }
  put(bucket, key, value) { this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(bucket,key) DO UPDATE SET value=excluded.value').run(bucket,key,JSON.stringify(value)); return value; }
  insert(bucket, key, value) { return this.db.prepare('INSERT OR IGNORE INTO records VALUES (?,?,?)').run(bucket,key,JSON.stringify(value)).changes === 1; }
  remove(bucket, key) { this.db.prepare('DELETE FROM records WHERE bucket=? AND key=?').run(bucket,key); }
  values(bucket) { return this.db.prepare('SELECT value FROM records WHERE bucket=? ORDER BY key').all(bucket).map(row => JSON.parse(row.value)); }
  event(key, bot, value) { this.db.prepare('INSERT OR IGNORE INTO events(key,bot,value) VALUES (?,?,?)').run(key,bot,JSON.stringify(value)); }
  events(bot, after = 0, limit = 250) { return this.db.prepare('SELECT seq,key,value FROM events WHERE bot=? AND seq>? ORDER BY seq LIMIT ?').all(bot,after,Math.min(1000,Math.max(1,limit))).map(row => ({ seq: Number(row.seq), key: row.key, ...JSON.parse(row.value) })); }
  close() { this.db.close(); }
}
