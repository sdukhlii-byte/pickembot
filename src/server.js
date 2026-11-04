const express = require('express');

function createServer({ funnel, db, config }) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Click redirect: /r?u=<telegram_id>&m=<match_id>&s=<message code>
  app.get('/r', (req, res) => {
    const u = String(req.query.u || '');
    if (!/^\d{1,15}$/.test(u)) return res.redirect(302, config.coinplayLink);
    const target = funnel.onClick(u, {
      matchId: String(req.query.m || '').slice(0, 64),
      msg: String(req.query.s || '').slice(0, 32),
    });
    return res.redirect(302, target);
  });

  // Coinplay S2S postback:
  // /postback/coinplay?click_id={click_id}&event={reg|ftd}&secret=<POSTBACK_SECRET>
  const postback = (req, res) => {
    const q = { ...req.query, ...(req.body || {}) };
    if (config.postbackSecret && q.secret !== config.postbackSecret) {
      db.logEvent(null, 'pb_bad_secret', { ip: req.ip });
      return res.status(403).json({ ok: false });
    }
    const event = q.event || q.status || q.type;
    const result = funnel.onPostback(q.click_id || q.clickid || q.subid, event);
    return res.json(result);
  };
  app.get('/postback/coinplay', postback);
  app.post('/postback/coinplay', express.urlencoded({ extended: false }), express.json(), postback);

  return app;
}

module.exports = { createServer };
