// Uses Node's built-in SQLite (node:sqlite, Node 22.13+). No native compile step needed.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { ROOM_IMAGES, ROOM_AMENITIES } = require('./constants');

// Allows tests to use an in-memory database via DB_PATH=:memory:
const dbPath = process.env.DB_PATH || path.join(__dirname, 'hotel.db');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    room_no   TEXT    NOT NULL UNIQUE,
    type      TEXT    NOT NULL CHECK (type IN ('Single','Double','Deluxe','Suite')),
    price     REAL    NOT NULL CHECK (price > 0)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    guest_name  TEXT    NOT NULL,
    check_in    TEXT    NOT NULL,   -- YYYY-MM-DD
    check_out   TEXT    NOT NULL,   -- YYYY-MM-DD (exclusive: guest leaves that day)
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (check_out > check_in)
  );

  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE,
    password_hash  TEXT    NOT NULL,
    role           TEXT    NOT NULL CHECK (role IN ('guest','admin')) DEFAULT 'guest',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_room_dates
    ON bookings (room_id, check_in, check_out);
`);

function hasColumn(table, name) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name);
}

if (!hasColumn('rooms', 'image_url')) {
  db.exec('ALTER TABLE rooms ADD COLUMN image_url TEXT');
}
if (!hasColumn('rooms', 'amenities')) {
  db.exec("ALTER TABLE rooms ADD COLUMN amenities TEXT NOT NULL DEFAULT '[]'");
}
if (!hasColumn('bookings', 'user_id')) {
  db.exec('ALTER TABLE bookings ADD COLUMN user_id INTEGER REFERENCES users(id)');
}

const rooms = db.prepare('SELECT id, type, image_url, amenities FROM rooms').all();
const fill = db.prepare('UPDATE rooms SET image_url = ?, amenities = ? WHERE id = ?');
for (const r of rooms) {
  const img = r.image_url || ROOM_IMAGES[r.type] || ROOM_IMAGES.Single;
  const empty = !r.amenities || r.amenities === '[]';
  const am = empty ? JSON.stringify(ROOM_AMENITIES[r.type] || []) : r.amenities;
  if (img !== r.image_url || am !== r.amenities) fill.run(img, am, r.id);
}

// Run fn inside a write transaction (BEGIN IMMEDIATE locks out concurrent writers,
// so the overlap check and the insert are atomic).
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = db;
module.exports.transaction = transaction;
