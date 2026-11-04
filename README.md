# Esports Pick'em vs AI · by Coinplay — Telegram gasket bot

Second funnel approach. Instead of "read our AI picks", the user **plays**: picks the winner of today's CS2 / Dota 2 / Valorant matches, then sees what the AI models picked. After each match — right or wrong, streak, and the running score **You vs AI**. Coinplay appears when the user called a match right: "back your next call".

Built from competitor patterns seen in SPY_TG (Nov 2026):
- match-question headlines ("will X beat Y?") — the largest esports bettor ran 355 such creatives;
- a daily reason to come back (case-opening bots in CS2: free daily case);
- streaks as social proof (esports tipster channels) — here it's the user's own streak, not a claim.

## Flow

1. `/start <source>` — stores the ad tag; A/B by telegram_id: **A** (even) intro screen → "Make my picks"; **B** (odd) first match question right away.
2. **Slate:** up to 5 matches starting in the next 24 h, majority consensus only, no "needs a human" placeholders. Picks close 5 min before start. One pick per match.
3. **Reveal** right after the pick: "You and the AI agree" or "Bold call — 3 of 4 models went …" + the main reason.
4. **Grading** ~1 h after start (re-checks every 30 min up to ~6 h): result, ✅/❌ for the user and for the AI, score You–AI, streak, weekly rank.
5. **First correct pick** → first Coinplay message with a personal `/r` link (shown once).
6. **+30 h offer** only to users who picked but haven't won yet; skipped for non-pickers.
7. **Daily slate push** for 14 days — only when there are open matches the user hasn't picked.
8. **Stage pushes** after a click: no reg +3 h · reg without deposit +30 min, +24 h · all Coinplay pushes stop after FTD.
9. `/top` — weekly leaderboard (correct / graded). **No prizes** — bragging rights only (a prize would turn it into a sweepstake with its own legal rules per country). `/me` — own score. `/stats` — admins: starts, users who picked, clicks, regs, FTDs by source × variant.

## Ads for this bot (EN, ≤160 chars, tag `?start=esp_q<code>`)

| Code | Text | Angle |
| --- | --- | --- |
| q1 | [Team A] vs [Team B] tonight. Who wins? Make your call, then see what 4 AI models picked 🎮 | Match question |
| q2 | Think you read CS2 better than AI? Pick today's winners and keep score: You vs AI. | Challenge |
| q3 | 5 esports matches today. Call them before they start — results and your streak after each game. | Daily slate |
| q4 | The AI models split on tonight's match. Which side are you on? | Curiosity |
| q5 | For people who call the winner before the first round. Daily esports pick'em, free. | Identification |
| q6 | Your friends guess. You keep score. Pick CS2, Dota 2 and Valorant winners, track your streak 🎯 | Status |

Fill `[Team A] vs [Team B]` from the export on the day of the show; one tag per ad / host channel.

## HTTP

Same as the first bot: `/r?u=<tg_id>&m=<match>&s=<msg>` → Coinplay with `click_id`, `sub1..3`; `/postback/coinplay?click_id={click_id}&event=reg|ftd&secret=…`; `/health`.

## Deploy (Railway)

Volume at `/data`, variables from `.env.example`, start `npm start` (long polling). Same `sets.json` mapping note as the first bot: check `src/api.js → normalizeSet()` against one real export record; this bot also needs `result.winner` (or `result.correct` to derive it).

Can run next to `esports-ai-picks-bot` — separate bot token, separate database, same Coinplay postback URL pattern on its own domain.

## Tests

`npm test` — offline: A/B, slate, reveal, lock, duplicate picks, grading (winner and derived-from-correct), streak, You–AI score, first-win offer once, 30 h offer rules, weekly top, `/r`, postbacks, FTD stop, blocked users.
