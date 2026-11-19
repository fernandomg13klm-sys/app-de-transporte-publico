// Base de datos SQLite (viene incluida en Node 22, no hay que instalar nada).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const file = process.env.DB_PATH ?? path.join(process.cwd(), "data", "muevet.db");
if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    pass_hash TEXT NOT NULL,
    pass_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('pasajero', 'camion', 'taxi')),
    route_id TEXT,
    plate TEXT,
    balance INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    description TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS transactions_user ON transactions (user_id, id DESC);
  CREATE TABLE IF NOT EXISTS platform_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount INTEGER NOT NULL,
    description TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tickets (
    code TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    route_id TEXT NOT NULL,
    base INTEGER NOT NULL,
    fee INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    used_at INTEGER,
    driver_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passenger_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    driver_id TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    plate TEXT,
    pickup_lat REAL NOT NULL,
    pickup_lng REAL NOT NULL,
    dest_name TEXT NOT NULL,
    dest_lat REAL NOT NULL,
    dest_lng REAL NOT NULL,
    base INTEGER NOT NULL,
    fee INTEGER NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL,
    payment TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS trips_status ON trips (status);
`);

export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

// Ejecuta fn dentro de una transacción: o se guarda todo, o nada.
let depth = 0;
export function transaction(fn) {
  if (depth > 0) return fn(); // ya estamos dentro de una transacción
  db.exec("BEGIN IMMEDIATE");
  depth++;
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
  finally { depth--; }
}
