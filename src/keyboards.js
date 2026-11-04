const { Markup } = require('telegraf');
const T = require('./texts');
const { redirectUrl } = require('./links');

// Callback data must stay under 64 bytes: we send the side (a|b), not team names.
const kb = {
  intro: () => Markup.inlineKeyboard([[Markup.button.callback(T.btn.start, 'slate')]]),

  question: (m) =>
    Markup.inlineKeyboard([[
      Markup.button.callback(String(m.teamA).slice(0, 30), `pick:${m.id}:a`),
      Markup.button.callback(String(m.teamB).slice(0, 30), `pick:${m.id}:b`),
    ]]),

  afterPick: (hasMore) =>
    Markup.inlineKeyboard([
      hasMore ? [Markup.button.callback(T.btn.nextMatch, 'slate')] : [Markup.button.callback(T.btn.top, 'top')],
      [Markup.button.callback(T.btn.myScore, 'me')],
    ]),

  graded: (config) =>
    Markup.inlineKeyboard([
      [Markup.button.callback(T.btn.slate, 'slate'), Markup.button.callback(T.btn.top, 'top')],
      [Markup.button.url(T.btn.channel, config.channelUrl)],
    ]),

  slate: () => Markup.inlineKeyboard([[Markup.button.callback(T.btn.slate, 'slate')]]),

  menu: (config) =>
    Markup.inlineKeyboard([
      [Markup.button.callback(T.btn.slate, 'slate')],
      [Markup.button.callback(T.btn.top, 'top'), Markup.button.callback(T.btn.myScore, 'me')],
      [Markup.button.url(T.btn.channel, config.channelUrl)],
    ]),

  coinplay: (config, userId, label, opts) =>
    Markup.inlineKeyboard([[Markup.button.url(label, redirectUrl(config, userId, opts))]]),
};

module.exports = kb;
