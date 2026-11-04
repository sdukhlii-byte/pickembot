// CoinPlay AI sets.json client + normalizer.
//
// The export's exact field names were not available when this was written,
// so normalizeSet() accepts several common spellings. If a match card shows
// empty fields, adjust pick() paths below against one real record
// (see fixtures/sets.sample.json for the shape the bot works with).

const fs = require('fs');
const path = require('path');

const GAME_ALIASES = {
  cs2: ['cs2', 'csgo', 'cs:go', 'counter-strike', 'counter strike', 'cs'],
  dota2: ['dota2', 'dota 2', 'dota'],
  valorant: ['valorant', 'val'],
};

function pick(obj, paths) {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function normGame(raw) {
  const s = String(raw || '').toLowerCase().trim();
  for (const [code, aliases] of Object.entries(GAME_ALIASES)) {
    if (aliases.some((a) => s === a || s.includes(a))) return code;
  }
  return null;
}

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  // Fixture helper: "now+90" / "now-180" = minutes relative to now.
  const rel = /^now([+-]\d+)$/.exec(String(v));
  if (rel) return Date.now() + Number(rel[1]) * 60_000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// Placeholder texts the prediction bot uses when it is not confident.
const LOW_CONFIDENCE = /needs a human/i;

function normalizeSet(s) {
  const teamA = pick(s, ['match.team_a', 'match.home', 'team_a', 'home', 'teams.0.name', 'teams.0']);
  const teamB = pick(s, ['match.team_b', 'match.away', 'team_b', 'away', 'teams.1.name', 'teams.1']);
  const game = normGame(pick(s, ['game', 'discipline', 'match.game', 'sport', 'category']));
  const startsAt = toMs(pick(s, ['match.start_time', 'start_time', 'starts_at', 'match.starts_at', 'kickoff', 'date']));

  const modelsRaw = pick(s, ['models', 'predictions', 'model_predictions']) || [];
  const models = (Array.isArray(modelsRaw) ? modelsRaw : Object.entries(modelsRaw).map(([name, v]) => ({ name, ...v })))
    .map((m) => ({
      name: pick(m, ['name', 'model', 'id']) || 'model',
      pick: pick(m, ['pick', 'winner', 'prediction', 'side']),
      rationale: pick(m, ['rationale', 'reason', 'reasoning', 'why']) || '',
    }))
    .filter((m) => m.pick);

  let consensusPick = pick(s, ['consensus.pick', 'consensus.winner', 'consensus']);
  if (typeof consensusPick === 'object') consensusPick = undefined;
  let agree = pick(s, ['consensus.agree', 'consensus.count']);
  const total = pick(s, ['consensus.total']) || models.length;
  if (models.length) {
    const tally = {};
    for (const m of models) tally[m.pick] = (tally[m.pick] || 0) + 1;
    const [topPick, topCount] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    if (!consensusPick) consensusPick = topPick;
    if (agree == null) agree = tally[consensusPick] || topCount;
  }

  const resultRaw = pick(s, ['result', 'graded', 'outcome']);
  let result = null;
  if (resultRaw && typeof resultRaw === 'object') {
    const status = String(pick(resultRaw, ['status', 'state']) || '').toLowerCase();
    const correct = pick(resultRaw, ['correct', 'hit', 'is_correct']);
    const winner = pick(resultRaw, ['winner']);
    const graded = ['graded', 'final', 'finished', 'settled', 'done'].includes(status) || typeof correct === 'boolean';
    if (graded) {
      result = {
        score: pick(resultRaw, ['score', 'final_score']) || '',
        winner: winner || null,
        correct: typeof correct === 'boolean' ? correct : (winner ? winner === consensusPick : null),
      };
    }
  }

  const rationaleText = models.map((m) => m.rationale).join(' ');
  return {
    id: String(pick(s, ['id', 'set_id', 'match.id', 'match_id']) || `${teamA}-${teamB}-${startsAt}`),
    game,
    teamA: teamA && String(teamA),
    teamB: teamB && String(teamB),
    tournament: pick(s, ['match.tournament', 'tournament', 'league', 'event']) || '',
    startsAt,
    consensusPick: consensusPick && String(consensusPick),
    agree: Number(agree || 0),
    total: Number(total || 0),
    models,
    result,
    lowConfidence: LOW_CONFIDENCE.test(rationaleText) || LOW_CONFIDENCE.test(String(pick(s, ['note', 'text']) || '')),
  };
}

function isUsable(m) {
  return m.game && m.teamA && m.teamB && m.startsAt && m.consensusPick && !m.lowConfidence
    && m.total > 0 && m.agree * 2 > m.total; // majority only
}

function createApi(config, { fetchImpl = global.fetch, cacheMs = 60_000 } = {}) {
  let cache = { at: 0, items: [] };

  async function loadRaw() {
    if (config.setsMock) {
      return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sets.sample.json'), 'utf8'));
    }
    const res = await fetchImpl(config.setsUrl, {
      headers: { Authorization: `Bearer ${config.setsToken}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`sets.json HTTP ${res.status}`);
    return res.json();
  }

  async function all() {
    if (cache.at && Date.now() - cache.at < cacheMs) return cache.items;
    try {
      const raw = await loadRaw();
      const list = Array.isArray(raw) ? raw : (raw.sets || raw.items || raw.data || []);
      cache = { at: Date.now(), items: list.map(normalizeSet).filter((m) => m.game) };
    } catch (e) {
      console.error('[api] load failed:', e.message);
      if (!cache.items.length) throw e;
    }
    return cache.items;
  }

  // Upcoming usable matches for a game, soonest first, within the next 48h.
  async function upcoming(game, { now = Date.now(), horizonMs = 48 * 3600e3 } = {}) {
    const items = await all();
    return items
      .filter((m) => m.game === game && isUsable(m) && !m.result
        && m.startsAt > now && m.startsAt < now + horizonMs)
      .sort((a, b) => a.startsAt - b.startsAt);
  }

  async function byId(id) {
    const items = await all();
    return items.find((m) => m.id === String(id)) || null;
  }

  // Graded record for a game (all time in the export).
  async function record(game) {
    const items = await all();
    const graded = items.filter((m) => (!game || m.game === game) && m.result && typeof m.result.correct === 'boolean');
    return { total: graded.length, correct: graded.filter((m) => m.result.correct).length };
  }

  return { all, upcoming, byId, record, _reset: () => { cache = { at: 0, items: [] }; } };
}

module.exports = { createApi, normalizeSet, isUsable, normGame };
