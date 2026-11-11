'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.BOT_TOKEN = 'test';
process.env.COINPLAY_LINK = 'https://coinplay.example/aff?a=1';
process.env.PUBLIC_URL = 'https://bot.example';
process.env.POSTBACK_SECRET = 's3';

const config = require('../src/config');
const { openDb } = require('../src/db');
const { createServer } = require('../src/server');
const { buildKeyboard } = require('../src/keyboard');

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ port, path: p }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    }).on('error', reject);
  });
}

test('keyboard: 3 main buttons + socials rows with correct types and styles', () => {
  const kb = buildKeyboard(config, 42);
  const [[play], [web], [comm], socials1, socials2] = kb.inline_keyboard;
  assert.deepStrictEqual(socials1.map((b) => b.text), ['X', 'Threads', 'Instagram']);
  assert.deepStrictEqual(socials2.map((b) => b.text), ['YouTube', 'Discord', 'Support']);
  assert.strictEqual(socials2[2].url, 'https://t.me/Coinplay_Help');
  assert.strictEqual(play.web_app.url, 'https://bot.example/r?c=42&m=app');
  assert.strictEqual(play.style, 'primary');
  assert.strictEqual(web.url, 'https://bot.example/r?c=42&m=web');
  assert.strictEqual(web.style, 'danger');
  assert.strictEqual(comm.url, 'https://t.me/thecoinplay');
  assert.strictEqual(comm.style, undefined);
});

test('redirect adds click_id, logs click; postback stores event', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpbot-'));
  const db = openDb(dir);
  const app = createServer(config, db);
  const srv = app.listen(0);
  const port = srv.address().port;

  try {
    const r = await get(port, '/r?c=42&m=app');
    assert.strictEqual(r.statusCode, 302);
    assert.strictEqual(r.headers.location, 'https://coinplay.example/aff?a=1&click_id=42');

    const bad = await get(port, '/postback/coinplay?click_id=42&event=reg');
    assert.strictEqual(bad.statusCode, 403);

    const ok = await get(port, '/postback/coinplay?click_id=42&event=ftd&amount=10&secret=s3');
    assert.strictEqual(ok.statusCode, 200);

    const s = db.stats();
    assert.deepStrictEqual(s.clicks.map((c) => [c.kind, c.n]), [['play_app', 1]]);
    assert.deepStrictEqual(s.events.map((e) => [e.event, e.n]), [['ftd', 1]]);
    const payload = db.raw.prepare('SELECT payload FROM events').get().payload;
    assert.ok(!payload.includes('s3'), 'secret must not be stored');
  } finally {
    srv.close();
  }
});
