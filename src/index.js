const { Telegraf } = require('telegraf');
const config = require('./config');
const { openDb } = require('./db');
const { createApi } = require('./api');
const { createFunnel } = require('./funnel');
const { createServer } = require('./server');

if (!config.botToken) {
  console.error('BOT_TOKEN is not set');
  process.exit(1);
}
if (config.setsMock) console.warn('[api] SETS_URL not set or SETS_MOCK=1 — using fixtures/sets.sample.json');

const db = openDb(config.dbPath);
const api = createApi(config);
const bot = new Telegraf(config.botToken);

const tg = { send: (userId, html, extra) => bot.telegram.sendMessage(userId, html, extra) };
const funnel = createFunnel({ db, api, config, tg });

const safe = (fn) => async (ctx) => {
  try {
    await fn(ctx);
  } catch (e) {
    console.error('[handler]', e);
  } finally {
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  }
};

bot.start(safe((ctx) => funnel.onStart(ctx.from, ctx.startPayload)));
bot.action('slate', safe((ctx) => funnel.onSlate(ctx.from)));
bot.action(/^pick:(.{1,50}):(a|b)$/, safe((ctx) => funnel.onPick(ctx.from, ctx.match[1], ctx.match[2])));
bot.action('top', safe((ctx) => funnel.onTop(ctx.from)));
bot.action('me', safe((ctx) => funnel.onMe(ctx.from)));
bot.command('top', safe((ctx) => funnel.onTop(ctx.from)));
bot.command('me', safe((ctx) => funnel.onMe(ctx.from)));
bot.command('picks', safe((ctx) => funnel.onSlate(ctx.from)));

bot.command('stats', safe(async (ctx) => {
  if (!config.adminIds.includes(ctx.from.id)) return;
  const rows = db.stats();
  if (!rows.length) return ctx.reply('No users yet.');
  return ctx.reply(rows.map((r) =>
    `${r.src} [${r.variant}]: start ${r.starts} · picked ${r.pickers} · click ${r.clicks} · reg ${r.regs} · ftd ${r.ftds} · blocked ${r.blocked}`,
  ).join('\n'));
}));

bot.on('message', safe((ctx) => {
  if (ctx.chat.type !== 'private') return;
  return funnel.onSlate(ctx.from);
}));

createServer({ funnel, db, config }).listen(config.port, () => console.log(`[http] listening on :${config.port}`));

let ticking = false;
setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    const done = await funnel.tick();
    if (done.length) console.log(`[tick] ${done.length} jobs`, done.map((d) => `${d.kind}:${d.res}`).join(' '));
  } catch (e) {
    console.error('[tick]', e);
  } finally {
    ticking = false;
  }
}, config.tickSeconds * 1000);

bot.launch({ dropPendingUpdates: true }).catch((e) => {
  console.error('[bot] launch failed', e);
  process.exit(1);
});
console.log('[bot] started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
