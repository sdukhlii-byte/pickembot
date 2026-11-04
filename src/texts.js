// User-facing copy (EN). Game: the user picks winners, then sees how the AI
// models picked; after the match — "You vs AI" score and streak.
// No prizes are promised (no sweepstakes): the weekly top is for bragging rights.

const GAME_NAMES = { cs2: 'CS2', dota2: 'Dota 2', valorant: 'Valorant' };
const GAME_EMOJI = { cs2: '🎮', dota2: '🛡️', valorant: '🎯' };
const RG = '18+ · Play responsibly.';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fmtTime(ms) {
  const d = new Date(ms);
  return `${d.toUTCString().slice(0, 11)} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

const scoreLine = (u) => `You ${u.score_user} – ${u.score_ai} AI`;

module.exports = {
  GAME_NAMES,
  esc,

  intro: () =>
    '<b>Can you read esports better than AI?</b>\n\n' +
    'Pick the winner of today\'s CS2, Dota 2 and Valorant matches. Then see what our AI models picked.\n\n' +
    'After each match: right or wrong, your streak, and the running score — <b>You vs AI</b>.',

  matchQuestion: (m, i, n) =>
    `${GAME_EMOJI[m.game] || '🎮'} <b>${n > 1 ? `Match ${i + 1} of ${n}: ` : ''}${esc(m.teamA)} vs ${esc(m.teamB)}</b>\n` +
    `${m.tournament ? esc(m.tournament) + ' · ' : ''}⏰ ${fmtTime(m.startsAt)}\n\nWho wins?`,

  noSlate: () =>
    'No matches open for picks right now. A new slate drops every day — we\'ll ping you.',

  allPicked: () => 'You\'ve picked every open match. Results come after each game — we\'ll ping you.',

  locked: () => '⛔ Picks for this match are locked — it has already started.',
  already: (p) => `You already picked <b>${esc(p.pick)}</b> here. One pick per match.`,

  reveal(m, pick) {
    const backers = m.models.filter((x) => x.pick === m.consensusPick);
    const why = backers.find((x) => x.rationale)?.rationale || '';
    const agree = pick === m.consensusPick;
    const head = agree
      ? `✅ You and the AI agree: <b>${esc(pick)}</b>.`
      : `🔥 Bold call. You picked <b>${esc(pick)}</b> — ${m.agree} of ${m.total} models went <b>${esc(m.consensusPick)}</b>.`;
    return `${head}${why ? `\n\nAI's main reason: ${esc(why)}` : ''}\n\nResult comes about an hour after the match.`;
  },

  graded(m, p, u, rank) {
    const youTxt = p.correct === 1 ? '✅ You called it' : p.correct === 0 ? '❌ Not this time' : 'Graded';
    const aiTxt = p.ai_correct === 1 ? 'AI was right' : p.ai_correct === 0 ? 'AI missed' : '';
    const score = m.result.score ? ` ${esc(m.result.score)} ` : ' vs ';
    const lines = [
      `<b>${esc(m.teamA)}${score}${esc(m.teamB)}</b>`,
      `${youTxt}${aiTxt ? ` · ${aiTxt}` : ''}`,
      '',
      `Score: <b>${scoreLine(u)}</b>`,
      `Streak: ${u.streak}${u.best_streak > u.streak ? ` (best ${u.best_streak})` : ''}`,
    ];
    if (rank) lines.push(`This week: #${rank.rank} of ${rank.of}`);
    return lines.join('\n');
  },

  // First correct pick → first Coinplay mention (soft).
  firstWin: (cfg) =>
    `Called it. If you'd rather back your next call than just track it — Coinplay takes CS2, Dota 2 and Valorant bets in crypto (${esc(cfg.coinsText)}).\n\n` +
    `New players: ${esc(cfg.bonusText)}.\n${RG}`,

  daily: (n) =>
    `🗓️ New slate: <b>${n} match${n === 1 ? '' : 'es'}</b> open for picks today. Can you beat the AI again?`,

  dailyNoUserScore: (n) =>
    `🗓️ <b>${n} match${n === 1 ? '' : 'es'}</b> open for picks today. Make your calls before they start.`,

  // +30h if the user has picked but never won yet
  offer: (cfg) =>
    `Your picks, your read. When you want to put a call behind it, Coinplay has esports markets in crypto — deposits and withdrawals in ${esc(cfg.coinsText)}.\n\n` +
    `New players: ${esc(cfg.bonusText)}.\n${RG}`,

  top(rows, me) {
    if (!rows.length) return '🏆 <b>This week\'s top</b>\n\nNo graded picks yet this week — be the first.';
    const medal = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r, i) =>
      `${medal[i] || `${i + 1}.`} ${esc(r.first_name || (r.username ? '@' + r.username : 'Player'))} — ${r.wins}/${r.graded}`);
    return `🏆 <b>This week's top</b> (correct / graded)\n\n${lines.join('\n')}` +
      (me ? `\n\nYou: #${me.rank} of ${me.of} with ${me.wins} correct` : '') +
      '\n\nNo prizes — just bragging rights.';
  },

  myScore: (u, picks) =>
    `<b>${scoreLine(u)}</b>\nStreak: ${u.streak} · best ${u.best_streak}\nPicks made: ${picks}`,

  // Stage pushes after a Coinplay click
  clickNoReg: () => 'Registration takes a minute — then your next call can count for more than the scoreboard.',
  regNoDep30: (cfg) =>
    `Your account is ready. Deposit in ${esc(cfg.coinsText)} to activate the new-player offer — terms: ${esc(cfg.bonusText)}. ${RG}`,
  regNoDep24: (n) =>
    `${n ? `${n} match${n === 1 ? '' : 'es'} open today. ` : ''}Your account is set — top up when you're ready. ${RG}`,

  btn: {
    start: '▶️ Make my picks',
    nextMatch: '➡️ Next match',
    slate: '🗓️ Today\'s matches',
    top: '🏆 Weekly top',
    myScore: '📊 My score',
    channel: '📢 AI picks channel',
    coinplay: '🎯 Back my next call',
    openCoinplay: 'Open Coinplay',
    register: 'Finish registration',
    deposit: 'Make a deposit',
  },
};
