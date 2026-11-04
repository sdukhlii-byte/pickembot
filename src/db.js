const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      src TEXT,
      variant TEXT,
      created_at INTEGER,
      streak INTEGER DEFAULT 0,
      best_streak INTEGER DEFAULT 0,
      score_user INTEGER DEFAULT 0,
      score_ai INTEGER DEFAULT 0,
      graded_count INTEGER DEFAULT 0,
      first_win_at INTEGER,
      clicked_at INTEGER,
      reg_at INTEGER,
      ftd_at INTEGER,
      blocked INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS picks (
      user_id INTEGER NOT NULL,
      match_id TEXT NOT NULL,
      game TEXT,
      pick TEXT NOT NULL,
      ai_pick TEXT,
      created_at INTEGER NOT NULL,
      graded INTEGER DEFAULT 0,
      correct INTEGER,
      ai_correct INTEGER,
      PRIMARY KEY (user_id, match_id)
    );
    CREATE INDEX IF NOT EXISTS picks_graded ON picks(graded, created_at);
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      run_at INTEGER NOT NULL,
      payload TEXT,
      attempts INTEGER DEFAULT 0,
      done INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS jobs_due ON jobs(done, run_at);
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_once ON jobs(user_id, kind, payload);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL,
      meta TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_type ON events(type);
  `);

  const now = () => Date.now();

  const api = {
    raw: db,

    getUser: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),

    upsertUser({ id, username, first_name, src, variant }) {
      const existing = api.getUser(id);
      if (existing) {
        db.prepare('UPDATE users SET username = ?, first_name = ?, blocked = 0 WHERE id = ?')
          .run(username || null, first_name || null, id);
        return { user: api.getUser(id), isNew: false };
      }
      db.prepare(`INSERT INTO users (id, username, first_name, src, variant, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, username || null, first_name || null, src || 'organic', variant, now());
      return { user: api.getUser(id), isNew: true };
    },

    setUser(id, fields) {
      const keys = Object.keys(fields);
      if (!keys.length) return;
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => fields[k]), id);
    },

    // --- picks ---
    getPick: (userId, matchId) =>
      db.prepare('SELECT * FROM picks WHERE user_id = ? AND match_id = ?').get(userId, String(matchId)),

    addPick({ userId, matchId, game, pick, aiPick }) {
      const r = db.prepare(`INSERT OR IGNORE INTO picks (user_id, match_id, game, pick, ai_pick, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)`)
        .run(userId, String(matchId), game, pick, aiPick, now());
      return r.changes === 1;
    },

    pickedIds: (userId) =>
      db.prepare('SELECT match_id FROM picks WHERE user_id = ?').all(userId).map((r) => r.match_id),

    pickCount: (userId) => db.prepare('SELECT COUNT(*) c FROM picks WHERE user_id = ?').get(userId).c,

    gradePick(userId, matchId, correct, aiCorrect) {
      db.prepare('UPDATE picks SET graded = 1, correct = ?, ai_correct = ? WHERE user_id = ? AND match_id = ?')
        .run(correct == null ? null : Number(correct), aiCorrect == null ? null : Number(aiCorrect), userId, String(matchId));
    },

    // Weekly top by correct picks (ties: fewer graded picks = better accuracy, then earlier).
    weeklyTop(sinceMs, limit = 10) {
      return db.prepare(`
        SELECT u.id, u.first_name, u.username,
               SUM(p.correct = 1) AS wins, COUNT(*) AS graded, MIN(p.created_at) AS first_at
        FROM picks p JOIN users u ON u.id = p.user_id
        WHERE p.graded = 1 AND p.correct IS NOT NULL AND p.created_at >= ?
        GROUP BY u.id
        HAVING wins > 0
        ORDER BY wins DESC, graded ASC, first_at ASC
        LIMIT ?`).all(sinceMs, limit);
    },

    weeklyRank(userId, sinceMs) {
      const rows = api.weeklyTop(sinceMs, 100000);
      const i = rows.findIndex((r) => r.id === userId);
      return i === -1 ? null : { rank: i + 1, of: rows.length, wins: rows[i].wins };
    },

    // --- events / jobs ---
    logEvent(userId, type, meta) {
      db.prepare('INSERT INTO events (user_id, type, meta, created_at) VALUES (?, ?, ?, ?)')
        .run(userId || null, type, meta ? JSON.stringify(meta) : null, now());
    },

    schedule(userId, kind, runAt, payload = '') {
      db.prepare('INSERT OR IGNORE INTO jobs (user_id, kind, run_at, payload) VALUES (?, ?, ?, ?)')
        .run(userId, kind, runAt, String(payload));
    },

    dueJobs(limit = 200) {
      return db.prepare('SELECT * FROM jobs WHERE done = 0 AND run_at <= ? ORDER BY run_at LIMIT ?')
        .all(now(), limit);
    },

    finishJob: (id) => db.prepare('UPDATE jobs SET done = 1 WHERE id = ?').run(id),

    retryJob(id, runAt) {
      db.prepare('UPDATE jobs SET run_at = ?, attempts = attempts + 1 WHERE id = ?').run(runAt, id);
    },

    cancelJobs(userId, kinds) {
      const q = kinds
        ? `UPDATE jobs SET done = 1 WHERE user_id = ? AND done = 0 AND kind IN (${kinds.map(() => '?').join(',')})`
        : 'UPDATE jobs SET done = 1 WHERE user_id = ? AND done = 0';
      db.prepare(q).run(userId, ...(kinds || []));
    },

    stats() {
      return db.prepare(`
        SELECT u.src, u.variant,
          COUNT(*) AS starts,
          SUM((SELECT COUNT(*) FROM picks p WHERE p.user_id = u.id) > 0) AS pickers,
          SUM(u.clicked_at IS NOT NULL) AS clicks,
          SUM(u.reg_at IS NOT NULL) AS regs,
          SUM(u.ftd_at IS NOT NULL) AS ftds,
          SUM(u.blocked) AS blocked
        FROM users u GROUP BY u.src, u.variant ORDER BY starts DESC`).all();
    },
  };

  return api;
}

module.exports = { openDb };
