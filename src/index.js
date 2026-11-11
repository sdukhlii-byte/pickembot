'use strict';

const config = require('./config');
const { openDb } = require('./db');
const { createServer } = require('./server');
const { createBot } = require('./bot');

async function main() {
  const db = openDb(config.dataDir);
  const app = createServer(config, db);

  const server = app.listen(config.port, () => {
    console.log(`[http] listening on :${config.port}`);
    console.log(`[http] public url: ${config.publicUrl || '(not set — buttons will link straight to the offer without tracking)'}`);
  });

  const bot = createBot(config, db);

  // Long polling. Run exactly ONE replica of this service (two pollers conflict).
  await bot.telegram.deleteWebhook({ drop_pending_updates: false });
  bot.launch({ allowedUpdates: ['message', 'my_chat_member'] }).catch((e) => {
    console.error('[bot] launch failed:', e.message);
    process.exit(1);
  });
  const me = await bot.telegram.getMe();
  console.log(`[bot] @${me.username} is up`);

  const stop = (sig) => {
    console.log(`[sys] ${sig}, shutting down`);
    bot.stop(sig);
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
