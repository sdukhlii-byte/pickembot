// Personal tracking links: every Coinplay button goes through /r so the click
// is logged and click_id=<telegram_id> reaches Coinplay for reg/ftd postbacks.

function redirectUrl(config, userId, { matchId = '', msg = '' } = {}) {
  const q = new URLSearchParams({ u: String(userId) });
  if (matchId) q.set('m', String(matchId));
  if (msg) q.set('s', String(msg));
  return `${config.publicUrl}/r?${q.toString()}`;
}

function coinplayUrl(config, user, { matchId = '', msg = '' } = {}) {
  const url = new URL(config.coinplayLink);
  url.searchParams.set('click_id', String(user.id));
  url.searchParams.set('sub1', user.src || 'organic');
  if (msg) url.searchParams.set('sub2', msg);
  if (matchId) url.searchParams.set('sub3', matchId);
  return url.toString();
}

module.exports = { redirectUrl, coinplayUrl };
