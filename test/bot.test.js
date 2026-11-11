'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.BOT_TOKEN = 'test';
process.env.COINPLAY_LINK = 'https://coinplay.example/aff?a=1';
process.env.PUBLIC_URL = 'https://bot.example';

const { Telegram } = require('telegraf');
const config = require('../src/config');
const { openDb } = require('../src/db');
const { createBot } = require('../src/bot');

function startUpdate(payload) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: 7, type: 'private' },
      from: { id: 7, is_bot: false, first_name: 'T', username: 'tt', language_code: 'en' },
      text: payload ? `/start ${payload}` : '/start',
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    },
  };
}

async function run(videoEnv, localPhoto = '/nonexistent') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpbot-'));
  const db = openDb(dir);
  const cfg = { ...config, welcomeVideo: videoEnv, welcomePhoto: '', localVideo: '/nonexistent', localPhoto };
  const bot = createBot(cfg, db);
  bot.botInfo = { id: 1, is_bot: true, username: 'cpbot', first_name: 'cp' };
  const calls = [];
  // handleUpdate gives each context its own Telegram client, so stub the prototype
  const orig = Telegram.prototype.callApi;
  Telegram.prototype.callApi = async function (method, data) {
    calls.push({ method, data });
    return { message_id: 2, video: { file_id: 'FILEID123' }, photo: [{ file_id: 'SMALL' }, { file_id: 'PHOTOID1' }] };
  };
  try {
    await bot.handleUpdate(startUpdate('users_de_x'));
  } finally {
    Telegram.prototype.callApi = orig;
  }
  return { calls, db };
}

test('/start with video: sendVideo + HTML caption + keyboard, user saved, file_id cached', async () => {
  const { calls, db } = await run('https://example.com/v.mp4');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'sendVideo');
  assert.strictEqual(calls[0].data.parse_mode, 'HTML');
  assert.ok(calls[0].data.caption.includes('<blockquote>'));
  assert.ok(!calls[0].data.caption.includes('[['), 'no placeholders left');
  assert.ok(calls[0].data.caption.length <= 1024, 'fits video caption limit');
  assert.ok(!/free/i.test(calls[0].data.caption), 'marketing rule: no "free"');
  assert.strictEqual(calls[0].data.reply_markup.inline_keyboard.length, 5);
  assert.strictEqual(db.getKv('welcome_video_file_id'), 'FILEID123');
  assert.strictEqual(db.raw.prepare('SELECT start_param FROM users WHERE telegram_id = 7').get().start_param, 'users_de_x');
});

test('/start without video: plain message with keyboard', async () => {
  const { calls } = await run('');
  assert.strictEqual(calls[0].method, 'sendMessage');
  assert.strictEqual(calls[0].data.reply_markup.inline_keyboard[0][0].style, 'primary');
});

test('/start with only the cover picture: sendPhoto with caption + keyboard, file_id cached', async () => {
  const { calls, db } = await run('', path.join(__dirname, '..', 'assets', 'welcome.png'));
  assert.strictEqual(calls[0].method, 'sendPhoto');
  assert.ok(calls[0].data.caption.includes('<blockquote>'));
  assert.ok(calls[0].data.caption.length <= 1024);
  assert.strictEqual(calls[0].data.reply_markup.inline_keyboard.length, 5);
  assert.strictEqual(db.getKv('welcome_photo_file_id'), 'PHOTOID1');
});
