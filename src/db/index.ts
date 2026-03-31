import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config.js';
import { createTables } from './schema.js';

let db: BetterSqlite3.Database;

export function getDb(): BetterSqlite3.Database {
  if (!db) {
    mkdirSync(dirname(config.db.path), { recursive: true });
    db = new BetterSqlite3(config.db.path);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    createTables(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
