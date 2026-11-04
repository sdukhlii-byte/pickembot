// Offline tests: no Telegram, no network. Run: npm test
const assert = require('assert');
const http = require('http');

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock; // one virtual clock for db, api and funnel

process.env.SETS_MOCK = '1';
const config = { ...require('../src/config'), setsMock: true, dbPath: ':memory:', publicUrl: 'https://bot.test',
  coinplayLink: 'https://coinplay.example/?ref=abc', postbackSecret: 's3cret', bonusText: 'BONUS', coinsText: 'USDT' };

const { openDb } = require('../src/db');
const { createApi } = require('../src/api');
const { createFunnel, winnerOf } = require('../src/funnel');
const { createServer } = require('../src/server');

const sent = [];
const tg = { async send(id, html, extra) { sent.push({ id, html, extra }); } };
const db = openDb(':memory:');
const api = createApi(config, { cacheMs: Infinity });
const funnel = createFunnel({ db, api, config, tg, now: () => clock });

const MIN = 60_000;
const HOUR = 60 * MIN;
let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('ok  ', name); }
  catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; }
}
const last = () => sent[sent.length - 1];
const mine = (id, re) => sent.filter((s) => s.id === id && re.test(s.html));
const buttons = (m) => (m.extra.reply_markup?.inline_keyboard || []).flat();

// Make a fixture match "finished" with a given winner for the rest of the run.
const results = {};
const origById = api.byId;
api.byId = async (id) => {
  const m = await origById(id);
  return m && results[m.id] ? { ...m, result: results[m.id] } : m;
};

(async () => {
  const A = { id: 1000, first_name: 'Alex' }; // even -> variant A (intro)
  const B = { id: 1001, first_name: 'Bo' };   // odd  -> variant B (question first)

  await t('variant A: intro, source tag, daily + offer jobs', async () => {
    await funnel.onStart(A, 'esp_q1');
    assert.match(last().html, /better than AI/);
    assert.strictEqual(db.getUser(1000).src, 'esp_q1');
    const jobs = db.raw.prepare('SELECT kind, COUNT(*) c FROM jobs WHERE user_id = 1000 GROUP BY kind').all();
    assert.deepStrictEqual(Object.fromEntries(jobs.map((j) => [j.kind, j.c])), { daily: 14, offer: 1 });
  });

  await t('variant B: first question right away; slate skips low-confidence', async () => {
    await funnel.onStart(B, 'esp_q2');
    const q = last();
    assert.match(q.html, /Match 1 of 4: Team Alpha vs Team Bravo/);
    assert.deepStrictEqual(buttons(q).map((b) => b.callback_data), ['pick:cs2-001:a', 'pick:cs2-001:b']);
  });

  await t('pick against AI -> "bold call" reveal; next question follows', async () => {
    await funnel.onSlate(A);
    await funnel.onPick(A, 'cs2-001', 'b');
    assert.match(last().html, /Bold call.*Team Bravo.*3 of 4 models went <b>Team Alpha/s);
    assert.ok(buttons(last()).some((b) => b.callback_data === 'slate'));
    await funnel.onSlate(A);
    assert.match(last().html, /Match 2 of 4: Team Golf vs Team Hotel/);
  });

  await t('pick with AI -> agreement; duplicate pick refused', async () => {
    await funnel.onPick(A, 'dota-001', 'a');
    assert.match(last().html, /You and the AI agree: <b>Team Golf/);
    await funnel.onPick(A, 'dota-001', 'b');
    assert.match(last().html, /already picked <b>Team Golf/);
    assert.strictEqual(db.getPick(1000, 'dota-001').pick, 'Team Golf');
  });

  await t('B picks with AI on cs2-001', async () => {
    await funnel.onPick(B, 'cs2-001', 'a');
    assert.match(last().html, /agree/);
  });

  await t('picks lock 5 min before start', async () => {
    clock += 86 * MIN; // cs2-001 at +90
    await funnel.onPick({ id: 3003 }, 'cs2-001', 'a');
    assert.match(last().html, /locked/);
    assert.strictEqual(db.getPick(3003, 'cs2-001'), undefined);
  });

  await t('grade waits for result, then: A wins vs AI, gets streak, score and first-win offer', async () => {
    clock += 70 * MIN; // past cs2-001 +60m
    let r = await funnel.tick();
    assert.ok(r.some((x) => x.kind === 'grade' && x.res.startsWith('retry')));
    results['cs2-001'] = { score: '1:2', winner: 'Team Bravo', correct: false };
    clock += 31 * MIN;
    await funnel.tick();
    const g = mine(1000, /You called it · AI missed/)[0];
    assert.ok(g, 'graded message');
    assert.match(g.html, /You 1 – 0 AI/);
    assert.match(g.html, /Streak: 1/);
    assert.match(g.html, /This week: #1 of 1/);
    const win = mine(1000, /Called it\. If you'd rather back/)[0];
    assert.ok(win && /18\+/.test(win.html) && /BONUS/.test(win.html));
    assert.ok(buttons(win)[0].url.startsWith('https://bot.test/r?u=1000&m=cs2-001&s=win1'));
    const b = mine(1001, /Not this time · AI missed/)[0];
    assert.ok(b && /You 0 – 0 AI/.test(b.html));
    assert.strictEqual(mine(1001, /Called it\./).length, 0);
  });

  await t('winner derived from "correct" when export has no winner', async () => {
    results['dota-001'] = { score: '2:0', correct: true };
    const m = await api.byId('dota-001');
    assert.strictEqual(winnerOf(m), 'Team Golf');
    clock += 3 * HOUR;
    await funnel.tick();
    const g = mine(1000, /Team Golf 2:0 Team Hotel/)[0];
    assert.ok(g && /You 2 – 1 AI/.test(g.html) && /Streak: 2/.test(g.html));
    assert.strictEqual(mine(1000, /Called it\. If you'd rather/).length, 1, 'first-win offer only once');
  });

  await t('weekly top lists players with correct picks', async () => {
    await funnel.onTop(B);
    assert.match(last().html, /🥇 Alex — 2\/2/);
    assert.match(last().html, /No prizes/);
    assert.doesNotMatch(last().html, /You: #/); // Bo has no correct picks
  });

  await t('30h offer: skipped for first-win user, skipped for non-picker, sent to engaged non-winner', async () => {
    await funnel.onStart({ id: 4004, first_name: 'Cy' }, 'esp_q3'); // never picks
    clock += 30 * HOUR;
    await funnel.tick();
    assert.strictEqual(mine(1000, /Your picks, your read/).length, 0);
    assert.strictEqual(mine(4004, /Your picks, your read/).length, 0);
    assert.strictEqual(mine(1001, /Your picks, your read/).length, 1);
  });

  await t('daily slate push only when matches are open', async () => {
    const dailies = sent.filter((s) => /open for picks today/.test(s.html));
    // fixture matches are all in the past by now -> no daily pushes
    assert.strictEqual(dailies.length, 0);
  });

  await t('/r click + reg/ftd postbacks; FTD stops Coinplay pushes', async () => {
    const u = new URL(funnel.onClick('1001', { msg: 'offer30h' }));
    assert.strictEqual(u.searchParams.get('click_id'), '1001');
    assert.strictEqual(u.searchParams.get('sub1'), 'esp_q2');
    clock += 3 * HOUR + MIN;
    await funnel.tick();
    assert.strictEqual(mine(1001, /Registration takes a minute/).length, 1);
    funnel.onPostback('1001', 'reg');
    clock += 31 * MIN;
    await funnel.tick();
    assert.strictEqual(mine(1001, /account is ready/).length, 1);
    funnel.onPostback('1001', 'ftd');
    clock += 2 * 24 * HOUR;
    await funnel.tick();
    assert.strictEqual(mine(1001, /account is set/).length, 0);
  });

  await t('blocked user: 403 cancels all jobs', async () => {
    const saved = tg.send;
    tg.send = async () => { const e = new Error('Forbidden'); e.response = { error_code: 403 }; throw e; };
    await funnel.onStart({ id: 5006 }, 'x');
    tg.send = saved;
    assert.strictEqual(db.getUser(5006).blocked, 1);
    assert.strictEqual(db.raw.prepare('SELECT COUNT(*) c FROM jobs WHERE user_id = 5006 AND done = 0').get().c, 0);
  });

  await t('HTTP /r and postback secret', async () => {
    const srv = createServer({ funnel, db, config }).listen(0);
    const port = srv.address().port;
    const get = (p) => new Promise((res) => http.get({ port, path: p, agent: false }, (r) => {
      let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res({ status: r.statusCode, loc: r.headers.location, body: b }));
    }));
    assert.match((await get('/r?u=1000&s=win1')).loc, /click_id=1000/);
    assert.strictEqual((await get('/postback/coinplay?click_id=1000&event=reg&secret=no')).status, 403);
    assert.deepStrictEqual(JSON.parse((await get('/postback/coinplay?click_id=1000&event=reg&secret=s3cret')).body), { ok: true });
    srv.close();
  });

  await t('stats: pickers per source', async () => {
    const rows = db.stats();
    assert.strictEqual(rows.find((r) => r.src === 'esp_q1').pickers, 1);
    assert.strictEqual(rows.find((r) => r.src === 'esp_q3').pickers, 0);
  });

  Date.now = realNow;
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
})();
