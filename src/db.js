'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function openDb(dataDir) {
  // Fall back to ./data when the volume is not mounted (local runs)
  let dir = dataDir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    dir = path.join(process.cwd(), 'data');
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(path.join(dir, 'bot.sqlite'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      username    TEXT,
      first_name  TEXT,
      lang        TEXT,
      start_param TEXT,
      created_at  INTEGER NOT NULL,
      last_start  INTEGER NOT NULL,
      blocked     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS clicks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      kind        TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clicks_user ON clicks(telegram_id);
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      event       TEXT NOT NULL,
      payload     TEXT,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_user ON events(telegram_id);
    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const now = () => Date.now();

  const q = {
    upsertUser: db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, lang, start_param, created_at, last_start)
      VALUES (@telegram_id, @username, @first_name, @lang, @start_param, @t, @t)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        lang = excluded.lang,
        last_start = excluded.last_start,
        blocked = 0,
        start_param = COALESCE(users.start_param, excluded.start_param)
    `),
    addClick: db.prepare('INSERT INTO clicks (telegram_id, kind, created_at) VALUES (?, ?, ?)'),
    addEvent: db.prepare('INSERT INTO events (telegram_id, event, payload, created_at) VALUES (?, ?, ?, ?)'),
    markBlocked: db.prepare('UPDATE users SET blocked = 1 WHERE telegram_id = ?'),
    getKv: db.prepare('SELECT value FROM kv WHERE key = ?'),
    setKv: db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    countBlocked: db.prepare('SELECT COUNT(*) AS n FROM users WHERE blocked = 1'),
    countClicks: db.prepare('SELECT kind, COUNT(*) AS n, COUNT(DISTINCT telegram_id) AS u FROM clicks GROUP BY kind'),
    countEvents: db.prepare('SELECT event, COUNT(*) AS n, COUNT(DISTINCT telegram_id) AS u FROM events GROUP BY event'),
    topSources: db.prepare(`
      SELECT COALESCE(start_param, '(none)') AS src, COUNT(*) AS n
      FROM users GROUP BY src ORDER BY n DESC LIMIT 10
    `),
  };

  return {
    raw: db,
    saveUser(u, startParam) {
      q.upsertUser.run({
        telegram_id: u.id,
        username: u.username || null,
        first_name: u.first_name || null,
        lang: u.language_code || null,
        start_param: startParam || null,
        t: now(),
      });
    },
    addClick(telegramId, kind) {
      q.addClick.run(telegramId, kind, now());
    },
    addEvent(telegramId, event, payload) {
      q.addEvent.run(telegramId, event, payload ? JSON.stringify(payload) : null, now());
    },
    markBlocked(telegramId) {
      q.markBlocked.run(telegramId);
    },
    getKv(key) {
      const r = q.getKv.get(key);
      return r ? r.value : null;
    },
    setKv(key, value) {
      q.setKv.run(key, value);
    },
    stats() {
      return {
        users: q.countUsers.get().n,
        blocked: q.countBlocked.get().n,
        clicks: q.countClicks.all(),
        events: q.countEvents.all(),
        sources: q.topSources.all(),
      };
    },
  };
}

module.exports = { openDb };
