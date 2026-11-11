'use strict';

const VALID_STYLES = new Set(['primary', 'success', 'danger']);

function withStyle(button, style) {
  // Telegram Bot API 9.4+: `style` colors the button. Unknown / "none" = default gray.
  if (VALID_STYLES.has(style)) button.style = style;
  return button;
}

/**
 * Builds the three-button keyboard from the welcome message:
 *   Play (mini app, blue)  /  Play on the web (link, red)  /  Join community! (link, gray)
 *
 * Both Play buttons go through our own /r redirect so every click is logged and the
 * Coinplay link gets click_id=<telegram_id> (needed for the postback attribution).
 */
function buildKeyboard(cfg, telegramId) {
  const rows = [];
  const base = cfg.publicUrl;
  const b = cfg.buttons;

  if (base) {
    rows.push([
      withStyle({ text: b.play.text, web_app: { url: `${base}/r?c=${telegramId}&m=app` } }, b.play.style),
    ]);
    rows.push([
      withStyle({ text: b.web.text, url: `${base}/r?c=${telegramId}&m=web` }, b.web.style),
    ]);
  } else {
    // No public URL yet (first deploy, domain not generated): link straight to the offer, no tracking.
    rows.push([withStyle({ text: b.web.text, url: withClickId(cfg, telegramId) }, b.web.style)]);
  }

  rows.push([withStyle({ text: b.community.text, url: cfg.communityUrl }, b.community.style)]);

  return { inline_keyboard: rows };
}

function withClickId(cfg, telegramId) {
  const u = new URL(cfg.coinplayLink);
  u.searchParams.set(cfg.clickParam, String(telegramId));
  return u.toString();
}

module.exports = { buildKeyboard, withClickId };
