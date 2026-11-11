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
    console.warn(`[offer] text is ${html.length} chars, media caption limit is ${CAPTION_LIMIT}. It will be sent as a separate message.`);
  }
  return html;
}

function resolveMedia(cfg, db) {
  // Video wins over photo. Within each: cached file_id -> env (file_id / https URL) -> local file in the repo.
  const vId = db.getKv('welcome_video_file_id');
  if (vId) return { type: 'video', kind: 'file_id', value: vId };
  if (cfg.welcomeVideo) return { type: 'video', kind: 'env', value: cfg.welcomeVideo };
  if (fs.existsSync(cfg.localVideo)) return { type: 'video', kind: 'local', value: cfg.localVideo };

  const pId = db.getKv('welcome_photo_file_id');
  if (pId) return { type: 'photo', kind: 'file_id', value: pId };
  if (cfg.welcomePhoto) return { type: 'photo', kind: 'env', value: cfg.welcomePhoto };
  if (fs.existsSync(cfg.localPhoto)) return { type: 'photo', kind: 'local', value: cfg.localPhoto };
  return null;
}

function createBot(cfg, db) {
  const bot = new Telegraf(cfg.botToken);
  const offerHtml = loadOffer(cfg);
  const fitsCaption = offerHtml.length <= CAPTION_LIMIT;

  async function sendWelcome(ctx) {
    const keyboard = buildKeyboard(cfg, ctx.from.id);
    const extra = { parse_mode: 'HTML', reply_markup: keyboard };
    const media = resolveMedia(cfg, db);

    if (!media) {
      return ctx.reply(offerHtml, { ...extra, link_preview_options: { is_disabled: true } });
    }

    const input = media.kind === 'local' ? Input.fromLocalFile(media.value) : media.value;
    const send = media.type === 'video'
      ? (opts) => ctx.replyWithVideo(input, { supports_streaming: true, ...opts })
      : (opts) => ctx.replyWithPhoto(input, opts);

    let msg;
    if (fitsCaption) {
      msg = await send({ ...extra, caption: offerHtml });
    } else {
      msg = await send({});
      await ctx.reply(offerHtml, { ...extra, link_preview_options: { is_disabled: true } });
    }

    // Cache file_id so the file is uploaded to Telegram only once
    if (media.kind !== 'file_id' && msg) {
      const fileId = media.type === 'video'
        ? msg.video && msg.video.file_id
        : msg.photo && msg.photo.length && msg.photo[msg.photo.length - 1].file_id;
      if (fileId) db.setKv(`welcome_${media.type}_file_id`, fileId);
    }
    return msg;
  }

  bot.start(async (ctx) => {
    try {
      db.saveUser(ctx.from, (ctx.startPayload || '').slice(0, 200));
      await sendWelcome(ctx);
    } catch (err) {
      // Cached file_id may be dead (e.g. token was re-issued) — drop it and retry once
      if (db.getKv('welcome_video_file_id') || db.getKv('welcome_photo_file_id')) {
        db.setKv('welcome_video_file_id', '');
        db.setKv('welcome_photo_file_id', '');
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

  // Admin: send a photo to set it as the welcome cover (used when no video is set)
  bot.on('photo', async (ctx) => {
    if (!cfg.adminIds.includes(ctx.from.id)) return;
    const sizes = ctx.message.photo;
    const fileId = sizes[sizes.length - 1].file_id;
    db.setKv('welcome_photo_file_id', fileId);
    await ctx.reply(`Saved as the welcome cover.\nfile_id:\n${fileId}`);
  });

  bot.on('my_chat_member', (ctx) => {
    const st = ctx.myChatMember.new_chat_member.status;
    if (st === 'kicked' && ctx.chat.type === 'private') db.markBlocked(ctx.chat.id);
  });

  bot.catch((err) => console.error('[bot] unhandled:', err.message));

  return bot;
}

module.exports = { createBot };
