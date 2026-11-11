'use strict';

const fs = require('fs');
const { Telegraf, Input } = require('telegraf');
const { buildKeyboard } = require('./keyboard');

const CAPTION_LIMIT = 1024; // Telegram limit for media captions

function loadOffer(cfg) {
  const html = fs.readFileSync(cfg.offerFile, 'utf8').trim();
  if (html.includes('[[')) {
    console.warn('[offer] offer/welcome.html still contains [[placeholders]] — fill them in before real traffic!');
  }
  if (html.length > CAPTION_LIMIT) {
    console.warn(`[offer] text is ${html.length} chars, video caption limit is ${CAPTION_LIMIT}. It will be sent as a separate message.`);
  }
  return html;
}

function resolveVideoSource(cfg, db) {
  // 1) file_id cached after the first successful upload
  const cached = db.getKv('welcome_video_file_id');
  if (cached) return { kind: 'file_id', value: cached };
  // 2) explicit env: file_id or https URL
  if (cfg.welcomeVideo) return { kind: 'env', value: cfg.welcomeVideo };
  // 3) local file in the repo
  if (fs.existsSync(cfg.localVideo)) return { kind: 'local', value: cfg.localVideo };
  return null;
}

function createBot(cfg, db) {
  const bot = new Telegraf(cfg.botToken);
  const offerHtml = loadOffer(cfg);
  const fitsCaption = offerHtml.length <= CAPTION_LIMIT;

  async function sendWelcome(ctx) {
    const keyboard = buildKeyboard(cfg, ctx.from.id);
    const extra = { parse_mode: 'HTML', reply_markup: keyboard };
    const video = resolveVideoSource(cfg, db);

    if (!video) {
      return ctx.reply(offerHtml, { ...extra, link_preview_options: { is_disabled: true } });
    }

    const input = video.kind === 'local' ? Input.fromLocalFile(video.value) : video.value;

    let msg;
    if (fitsCaption) {
      msg = await ctx.replyWithVideo(input, { ...extra, caption: offerHtml, supports_streaming: true });
    } else {
      msg = await ctx.replyWithVideo(input, { supports_streaming: true });
      await ctx.reply(offerHtml, { ...extra, link_preview_options: { is_disabled: true } });
    }

    // Cache file_id so the file is uploaded to Telegram only once
    if (video.kind !== 'file_id' && msg && msg.video && msg.video.file_id) {
      db.setKv('welcome_video_file_id', msg.video.file_id);
    }
    return msg;
  }

  bot.start(async (ctx) => {
    try {
      db.saveUser(ctx.from, (ctx.startPayload || '').slice(0, 200));
      await sendWelcome(ctx);
    } catch (err) {
      // Cached file_id may be dead (e.g. token was re-issued) — drop it and retry once
      if (db.getKv('welcome_video_file_id')) {
        db.setKv('welcome_video_file_id', '');
        try {
          await sendWelcome(ctx);
          return;
        } catch (err2) {
          console.error('[start] retry failed:', err2.message);
          return;
        }
      }
      console.error('[start] failed:', err.message);
    }
  });

  // Admin: /stats
  bot.command('stats', async (ctx) => {
    if (!cfg.adminIds.includes(ctx.from.id)) return;
    const s = db.stats();
    const lines = [
      `Users: ${s.users} (blocked the bot: ${s.blocked})`,
      '',
      'Clicks (total / unique users):',
      ...(s.clicks.length ? s.clicks.map((c) => `  ${c.kind}: ${c.n} / ${c.u}`) : ['  —']),
      '',
      'Postback events (total / unique users):',
      ...(s.events.length ? s.events.map((e) => `  ${e.event}: ${e.n} / ${e.u}`) : ['  —']),
      '',
      'Top start params:',
      ...s.sources.map((r) => `  ${r.src}: ${r.n}`),
    ];
    await ctx.reply(lines.join('\n'));
  });

  // Admin: get a video file_id by sending a video to the bot
  bot.on('video', async (ctx) => {
    if (!cfg.adminIds.includes(ctx.from.id)) return;
    const fileId = ctx.message.video.file_id;
    db.setKv('welcome_video_file_id', fileId);
    await ctx.reply(`Saved as the welcome video.\nfile_id:\n${fileId}`);
  });

  bot.on('my_chat_member', (ctx) => {
    const st = ctx.myChatMember.new_chat_member.status;
    if (st === 'kicked' && ctx.chat.type === 'private') db.markBlocked(ctx.chat.id);
  });

  bot.catch((err) => console.error('[bot] unhandled:', err.message));

  return bot;
}

module.exports = { createBot };
