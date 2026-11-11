'use strict';

const express = require('express');
const { withClickId } = require('./keyboard');

function createServer(cfg, db) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/', (_req, res) => res.status(200).send('ok'));
  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

  // Click tracking + redirect to the Coinplay offer with click_id=<telegram_id>
  app.get('/r', (req, res) => {
    const id = Number(req.query.c);
    const mode = req.query.m === 'app' ? 'play_app' : 'play_web';

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.redirect(302, cfg.coinplayLink);
    }
    try {
      db.addClick(id, mode);
    } catch (e) {
      console.error('[r] click log failed:', e.message);
    }
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, withClickId(cfg, id));
  });

  // Affiliate postback: /postback/coinplay?click_id=123&event=reg&secret=...
  // Configure the same URL in the Coinplay affiliate panel for each event (reg, ftd).
  // Macros in the panel are replaced by their system, e.g. click_id={click_id}&event=reg
  app.get('/postback/coinplay', (req, res) => {
    if (cfg.postbackSecret && req.query.secret !== cfg.postbackSecret) {
      return res.status(403).send('forbidden');
    }
    const id = Number(req.query.click_id);
    const event = String(req.query.event || '').toLowerCase().slice(0, 32);

    if (!Number.isSafeInteger(id) || id <= 0 || !event) {
      return res.status(400).send('bad request');
    }
    const { secret, ...payload } = req.query; // never store the secret
    try {
      db.addEvent(id, event, payload);
    } catch (e) {
      console.error('[postback] failed:', e.message);
      return res.status(500).send('error');
    }
    return res.status(200).send('ok');
  });

  return app;
}

module.exports = { createServer };
