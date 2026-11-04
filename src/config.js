const path = require('path');

function list(v) {
  return (v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const config = {
  botToken: process.env.BOT_TOKEN || '',
  adminIds: list(process.env.ADMIN_IDS).map(Number),
  channelUsername: (process.env.CHANNEL_USERNAME || 'coinplayesportai').replace(/^@/, ''),
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  port: Number(process.env.PORT || 3000),

  setsUrl: process.env.SETS_URL || '',
  setsToken: process.env.SETS_TOKEN || '',
  setsMock: process.env.SETS_MOCK === '1' || !process.env.SETS_URL,

  coinplayLink: process.env.COINPLAY_LINK || 'https://coinplay.com/',
  postbackSecret: process.env.POSTBACK_SECRET || '',

  bonusText: process.env.BONUS_TEXT || '[bonus, wager, term, min deposit]',
  coinsText: process.env.COINS_TEXT || 'USDT, BTC, ETH',

  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot.sqlite'),
  tickSeconds: Number(process.env.TICK_SECONDS || 60),
};

config.channelUrl = `https://t.me/${config.channelUsername}`;

module.exports = config;
