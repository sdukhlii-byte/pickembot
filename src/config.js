'use strict';

const path = require('path');

function req(name) {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function opt(name, def = '') {
  const v = (process.env[name] || '').trim();
  return v || def;
}

function trimSlash(s) {
  return s.replace(/\/+$/, '');
}

// Railway gives RAILWAY_PUBLIC_DOMAIN automatically when a public domain is generated.
function resolvePublicUrl() {
  const explicit = opt('PUBLIC_URL');
  if (explicit) return trimSlash(explicit);
  const railway = opt('RAILWAY_PUBLIC_DOMAIN');
  if (railway) return `https://${railway}`;
  return '';
}

const config = {
  botToken: req('BOT_TOKEN'),
  port: Number(opt('PORT', '3000')),
  publicUrl: resolvePublicUrl(),

  // Coinplay affiliate link. The bot appends click_id=<telegram_id> when redirecting.
  coinplayLink: req('COINPLAY_LINK'),
  clickParam: opt('CLICK_PARAM', 'click_id'),

  communityUrl: opt('COMMUNITY_URL', 'https://t.me/thecoinplay'),

  // Welcome video: Telegram file_id, https URL, or empty (then assets/welcome.mp4 is used if it exists)
  welcomeVideo: opt('WELCOME_VIDEO'),

  // Button labels and colors (primary = blue, danger = red, success = green, none = default gray)
  buttons: {
    play: { text: opt('BTN_PLAY_TEXT', 'Play'), style: opt('BTN_PLAY_STYLE', 'primary') },
    web: { text: opt('BTN_WEB_TEXT', 'Play on the web'), style: opt('BTN_WEB_STYLE', 'danger') },
    community: { text: opt('BTN_COMMUNITY_TEXT', 'Join community!'), style: opt('BTN_COMMUNITY_STYLE', 'none') },
  },

  // Optional secret for the postback endpoint: /postback/coinplay?secret=...
  postbackSecret: opt('POSTBACK_SECRET'),

  adminIds: opt('ADMIN_IDS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),

  // Railway volume is mounted at /data
  dataDir: opt('DATA_DIR', '/data'),
  offerFile: path.join(__dirname, '..', 'offer', 'welcome.html'),
  localVideo: path.join(__dirname, '..', 'assets', 'welcome.mp4'),
};

module.exports = config;
