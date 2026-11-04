// Pick'em funnel, independent of Telegram transport (tests inject a fake `tg`).
// tg = { send(userId, html, extra) -> Promise }

const T = require('./texts');
const kb = require('./keyboards');
const { coinplayUrl } = require('./links');
const { isUsable } = require('./api');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const LOCK_BEFORE = 5 * MIN; // picks close 5 min before the scheduled start
const SLATE_HORIZON = 24 * HOUR;
const SLATE_SIZE = 5;
const DAILY_DAYS = 14;
const COINPLAY_KINDS = ['offer', 'click_noreg', 'reg_nodep_30', 'reg_nodep_24'];

function variantFor(userId) {
  // A = intro screen first, B = first match question right away.
  return Number(userId) % 2 === 0 ? 'A' : 'B';
}

function parseSource(payload) {
  const p = String(payload || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(p) ? p : 'organic';
}

function winnerOf(m) {
  if (!m.result) return null;
  if (m.result.winner) return m.result.winner;
  // Only "correct" known: derive the winner from the consensus side.
  if (typeof m.result.correct === 'boolean') {
    return m.result.correct ? m.consensusPick : (m.consensusPick === m.teamA ? m.teamB : m.teamA);
  }
  return null;
}

function weekStart(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

function createFunnel({ db, api, config, tg, now = () => Date.now() }) {
  async function send(userId, html, extra = {}) {
    try {
      await tg.send(userId, html, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
      return true;
    } catch (e) {
      const code = e?.response?.error_code || e?.code;
      if (code === 403) {
        db.setUser(userId, { blocked: 1 });
        db.cancelJobs(userId);
        db.logEvent(userId, 'blocked');
        return false;
      }
      throw e;
    }
  }

  async function slate() {
    const t = now();
    const items = await api.all();
    return items
      .filter((m) => isUsable(m) && !m.result && m.startsAt - LOCK_BEFORE > t && m.startsAt < t + SLATE_HORIZON)
      .sort((a, b) => a.startsAt - b.startsAt)
      .slice(0, SLATE_SIZE);
  }

  async function openFor(userId) {
    const picked = new Set(db.pickedIds(userId));
    const list = await slate();
    return { list, open: list.filter((m) => !picked.has(m.id)) };
  }

  function ensureUser(from) {
    const existing = db.getUser(from.id);
    if (existing) return existing;
    return db.upsertUser({ id: from.id, username: from.username, first_name: from.first_name,
      src: 'organic', variant: variantFor(from.id) }).user;
  }

  async function askNext(userId) {
    const { list, open } = await openFor(userId);
    if (!list.length) return send(userId, T.noSlate(), kb.menu(config));
    if (!open.length) return send(userId, T.allPicked(), kb.menu(config));
    const m = open[0];
    db.logEvent(userId, 'question', { match: m.id });
    return send(userId, T.matchQuestion(m, list.indexOf(m), list.length), kb.question(m));
  }

  return {
    variantFor,
    parseSource,
    winnerOf,

    async onStart(from, payload) {
      const src = parseSource(payload);
      const { user, isNew } = db.upsertUser({
        id: from.id, username: from.username, first_name: from.first_name, src, variant: variantFor(from.id),
      });
      db.logEvent(user.id, isNew ? 'start' : 'restart', { src });
      if (isNew) {
        const t0 = now();
        for (let d = 1; d <= DAILY_DAYS; d++) db.schedule(user.id, 'daily', t0 + d * DAY, `d${d}`);
        db.schedule(user.id, 'offer', t0 + 30 * HOUR);
      }
      if (user.variant === 'A') return send(user.id, T.intro(), kb.intro());
      return askNext(user.id);
    },

    async onSlate(from) {
      const user = ensureUser(from);
      return askNext(user.id);
    },

    async onPick(from, matchId, side) {
      const user = ensureUser(from);
      const m = await api.byId(matchId);
      if (!m || (side !== 'a' && side !== 'b')) return askNext(user.id);
      if (m.startsAt - LOCK_BEFORE <= now() || m.result) return send(user.id, T.locked(), kb.slate());
      const pick = side === 'a' ? m.teamA : m.teamB;
      const added = db.addPick({ userId: user.id, matchId: m.id, game: m.game, pick, aiPick: m.consensusPick });
      if (!added) return send(user.id, T.already(db.getPick(user.id, m.id)), kb.slate());
      db.logEvent(user.id, 'pick', { match: m.id, agree: pick === m.consensusPick });
      db.schedule(user.id, 'grade', m.startsAt + HOUR, m.id);
      const { open } = await openFor(user.id);
      return send(user.id, T.reveal(m, pick), kb.afterPick(open.length > 0));
    },

    async onTop(from) {
      const user = ensureUser(from);
      const since = weekStart(now());
      return send(user.id, T.top(db.weeklyTop(since), db.weeklyRank(user.id, since)), kb.slate());
    },

    async onMe(from) {
      const user = ensureUser(from);
      return send(user.id, T.myScore(db.getUser(user.id), db.pickCount(user.id)), kb.menu(config));
    },

    // GET /r — returns the URL to redirect to.
    onClick(userId, { matchId = '', msg = '' } = {}) {
      const user = db.getUser(Number(userId));
      if (!user) return config.coinplayLink;
      db.logEvent(user.id, 'click', { match: matchId, msg });
      if (!user.clicked_at) db.setUser(user.id, { clicked_at: now() });
      if (!user.reg_at) db.schedule(user.id, 'click_noreg', now() + 3 * HOUR);
      return coinplayUrl(config, user, { matchId, msg });
    },

    onPostback(clickId, event) {
      const userId = Number(clickId);
      const user = Number.isFinite(userId) ? db.getUser(userId) : null;
      const ev = String(event || '').toLowerCase();
      db.logEvent(user ? user.id : null, `pb_${ev}`, { click_id: clickId });
      if (!user) return { ok: false, reason: 'unknown click_id' };
      if (ev === 'reg' || ev === 'registration') {
        if (!user.reg_at) {
          db.setUser(user.id, { reg_at: now() });
          db.cancelJobs(user.id, ['click_noreg']);
          db.schedule(user.id, 'reg_nodep_30', now() + 30 * MIN);
          db.schedule(user.id, 'reg_nodep_24', now() + 24 * HOUR);
        }
        return { ok: true };
      }
      if (ev === 'ftd' || ev === 'deposit' || ev === 'first_deposit') {
        if (!user.ftd_at) {
          db.setUser(user.id, { ftd_at: now(), reg_at: user.reg_at || now() });
          db.cancelJobs(user.id, COINPLAY_KINDS);
        }
        return { ok: true };
      }
      return { ok: false, reason: 'unknown event' };
    },

    async runJob(job) {
      const user = db.getUser(job.user_id);
      if (!user || user.blocked) return 'skip';
      const k = job.kind;
      if (COINPLAY_KINDS.includes(k) && user.ftd_at) return 'skip';

      if (k === 'grade') {
        const m = await api.byId(job.payload);
        const p = db.getPick(user.id, job.payload);
        if (!m || !p || p.graded) return 'skip';
        const winner = winnerOf(m);
        if (!winner) return job.attempts < 12 ? 'retry:30' : 'skip'; // wait up to ~6h for grading
        const correct = p.pick === winner;
        const aiCorrect = p.ai_pick === winner;
        db.gradePick(user.id, m.id, correct, aiCorrect);
        const streak = correct ? user.streak + 1 : 0;
        db.setUser(user.id, {
          streak,
          best_streak: Math.max(user.best_streak, streak),
          score_user: user.score_user + (correct ? 1 : 0),
          score_ai: user.score_ai + (aiCorrect ? 1 : 0),
          graded_count: user.graded_count + 1,
        });
        const u = db.getUser(user.id);
        const rank = db.weeklyRank(user.id, weekStart(now()));
        await send(user.id, T.graded(m, db.getPick(user.id, m.id), u, rank), kb.graded(config));
        db.logEvent(user.id, 'graded', { match: m.id, correct, aiCorrect });

        if (correct && !u.first_win_at && !u.ftd_at) {
          db.setUser(user.id, { first_win_at: now() });
          db.cancelJobs(user.id, ['offer']); // the win message is the first offer
          await send(user.id, T.firstWin(config),
            kb.coinplay(config, user.id, T.btn.coinplay, { matchId: m.id, msg: 'win1' }));
          db.logEvent(user.id, 'push_first_win');
        }
        return 'sent';
      }

      if (k === 'daily') {
        const { open } = await openFor(user.id);
        if (!open.length) return 'skip';
        await send(user.id, user.graded_count ? T.daily(open.length) : T.dailyNoUserScore(open.length), kb.slate());
        return 'sent';
      }

      if (k === 'offer') {
        if (user.first_win_at || db.pickCount(user.id) === 0) return 'skip'; // only engaged users
        await send(user.id, T.offer(config),
          kb.coinplay(config, user.id, T.btn.openCoinplay, { msg: 'offer30h' }));
        return 'sent';
      }

      if (k === 'click_noreg') {
        if (user.reg_at) return 'skip';
        await send(user.id, T.clickNoReg(),
          kb.coinplay(config, user.id, T.btn.register, { msg: 'p_reg' }));
        return 'sent';
      }

      if (k === 'reg_nodep_30') {
        await send(user.id, T.regNoDep30(config),
          kb.coinplay(config, user.id, T.btn.deposit, { msg: 'p_dep30' }));
        return 'sent';
      }

      if (k === 'reg_nodep_24') {
        const { open } = await openFor(user.id);
        await send(user.id, T.regNoDep24(open.length),
          kb.coinplay(config, user.id, T.btn.deposit, { msg: 'p_dep24' }));
        return 'sent';
      }

      return 'skip';
    },

    async tick() {
      const jobs = db.dueJobs();
      const out = [];
      for (const job of jobs) {
        let res;
        try {
          res = await this.runJob(job);
        } catch (e) {
          console.error(`[job ${job.id} ${job.kind}]`, e.message);
          res = job.attempts < 5 ? 'retry:10' : 'skip';
        }
        if (typeof res === 'string' && res.startsWith('retry:')) {
          db.retryJob(job.id, now() + Number(res.split(':')[1]) * MIN);
        } else {
          db.finishJob(job.id);
          if (res === 'sent') db.logEvent(job.user_id, `push_${job.kind}`);
        }
        out.push({ id: job.id, kind: job.kind, res });
      }
      return out;
    },
  };
}

module.exports = { createFunnel, variantFor, parseSource, winnerOf, weekStart, COINPLAY_KINDS };
