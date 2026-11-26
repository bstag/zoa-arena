# zoa-arena — Blackstag's Intuition Game agent + offline bench

Everything an agent needs to play and improve at **The Intuition Game**
(Zoa Games Agent Arena, <https://play.zoagames.com/arena/>): a 19-card deck
(16 unique color/character cards + 3 wilds), revealed one card at a time,
never reshuffled. Bet exact cards (10x), colors/characters (2x), wilds (5x,
10x when the dealer called wild), or with/against the dealer (1x). Most chips
after 19 rounds wins; ladder matches deal both agents the identical deck
(duplicate-deal 1v1).

Plain ESM JavaScript — node 18+, no build step.

## Where we are (2026-11-25)

- **Agent:** Blackstag (userId 395), registered 2026-11-20, rank 38 → **#2
  peak / #6 current**, Tier 5, ~1,300 chips in the first ~130 matches.
- **Live strategy:** `variants/arb.mjs` — full-press Kelly mid-game + the
  **endgame Dutch book** (cover every remaining card, stakes ∝ 1/multiplier;
  Σ(1/b) < 1 makes the round order-independent guaranteed profit: ×1.25 at
  deckLeft 8, ×2.5 at 4, ×3.33 at 2, ×10 at 1). One win went +204M this way.
- **Ladder loop:** `agent/agent.mjs` polls every 2 min — accepts all
  incoming, deals `toPlay`, challenges the best target; session-local
  `dealt` guard prevents the re-deal race that voided match 765.
- **Season:** Season 0 closes 2026-11-28; standings carry into Season 1
  (Dec 1 → Jan 15, **$490 USDC**, needs ≥5 completed challenge matches).

## Layout

```
agent/strategy.mjs     the base brain: deck counting, EV pricing, Kelly sizing
agent/agent.mjs        plumbing: socket play + ladder loop (join/defend/deal/challenge)
sim/simulate.mjs       offline A/B bench (house-fill table; floors/medians only)
variants/              strategy variants — arb.mjs is LIVE, others are documented
                       results (see "The four-schedule tie")
analysis/whatif-exact.mjs  THE decision instrument: exact paired replay
analysis/fingerprint.mjs   opponent learning loop (samples, classes, drift)
analysis/deck-classes.mjs  deck-space structure: wild-timing histogram vs theory
analysis/regret.mjs    post-match audit vs ex-post perfect play
opponents.json         versioned opponent fingerprints (per-match samples)
.replay-cache/         cached replay JSON (gitignored)
```

## The testing hierarchy (how decisions get made)

1. **`analysis/whatif-exact.mjs <matchId> <strategy>`** — the only instrument
   that decides anything. Replays a REAL ladder match from the published
   replay endpoint (`/api/agent/ladder/matches/<id>/replay`), substitutes
   ONLY our seat, keeps every house/opponent bet verbatim (bets are
   simultaneous, so this is a true counterfactual), and scores chip-for-chip
   against the real opponent's actual score. Calibrated to reproduce real
   scores exactly.
2. `sim/simulate.mjs` — house-fill synthetic decks; good for floor/bust
   statistics only. It re-simulates opponents and drifts 2–6× on real scores.
   NEVER use it to pick a strategy.
3. Skills-ladder duels vs house bots (`analysis/duel.mjs`) — smoke tests.
   Beating a weak house bot rewards floors, not ceilings.

**Ladder rule:** matches pay on the duplicate-deck comparison vs a specific
opponent. Surviving small loses to surviving bigger; the ceiling wins.

## The four-schedule tie (the central negative result)

Across all 14 real paired decks, four stake schedules are statistically
indistinguishable (~5 wins each, with single-deck coin-flip swaps):

| variant | idea | paired | house sim |
|---|---|---|---|
| `arb.mjs` (LIVE) | full-press Kelly + Dutch endgame | 5/14 | min −5, median 1.29M |
| `arb-moderate.mjs` | graduated dealer stakes 25→50→100% | 5/14 | min 605, 100% profitable |
| `steady.mjs` | cap every round at 35% (never bust) | 1/14 | min 1670, 0 busts/400 |
| `cold-open.mjs` | cap rounds while deck fat, press late | 5/14 | min 605, median 1.8M |

`arb-aggr.mjs` (mid-deck aggression flooring) was rejected earlier on the
same evidence. **Stake sizing is conclusively exhausted.** The match-2377
autopsy (we: 0, opponent: 10.15M on the same cards) shows why the differences
are noise: survival vs ceiling trades the same decks back and forth. The
opponent's edge was line selection (wild-hunting) and 2%-of-stack probe
discipline — not sizing.

## Opponent learning loop

`analysis/fingerprint.mjs` harvests every cached replay (duplicate-deal:
the opponent's REAL bets are in THEIR side of the replay), stores per-match
samples in `opponents.json`, and:

- classifies opponents at **≥3 samples**: overbetter / steady-presser /
  wait-then-fire / cautious;
- flags **DRIFT** when the newer half's stakes move ≥15 pts (sit-rate ≥10)
  vs the older half — already caught a live behavior change
  (RumangCounter dealer 38%→57%);
- prunes to 10 samples per opponent, newest kept.

Wired into the Zoa Watch digest (9am/9pm CT, change-gated cron) alongside
rank/results, so class changes and drift surface automatically.

## Deck-space structure (`analysis/deck-classes.mjs`)

Full deck space: ~2.0×10¹⁶ orders — unreachable and irrelevant. The
strategically dominant feature is **wild placement: C(19,3) = 969 classes**.
Measured against 80 real reconstructed decks:

- ≥1 wild in the first 8 rounds: **86.1%** (theory 83.0%)
- ≥1 wild in the last 6: **69.6%** (theory 70.5%)
- distinct classes touched: 78 of 969 (8%); coupon-collector to full
  coverage ≈ **7,250 games** — a season never gets there, so extrapolation
  from paired real-deck tests (not class memorization) stays the method.

Cold openings are the NORM (5 of 6 decks carry early-wild chaos). The 2377
lesson: price the opening like a lottery you must survive; hold conviction
for the endgame where wild positions become near-certainty and the Dutch
book + ×10 riders live.

## Setup

```
cp .env.example .env        # paste your IN2IT_API_KEY (never commit this file)
ZOA_STRATEGY=./variants/arb.mjs node agent/agent.mjs ladder
node analysis/whatif-exact.mjs <matchId> ./variants/arb.mjs
node analysis/fingerprint.mjs
node analysis/deck-classes.mjs
```

Register an agent first (needs a human account + invite code):
`POST /api/agent/register {"inviteCode":"AGT-...","name":"YourAgent"}` — the
key is shown once; store it in `.env`.

## Known pitfalls (each one cost us a match to learn)

- Server rejects stakes above your stack (`bad-amount`) — Dutch rounding is
  budget-capped, and the whole Dutch ABORTS (→ Kelly) if any line can't be
  funded at MIN_BET. Partial coverage voids the guarantee.
- The server's `iPlayed` flag lags a finished game — the poll used to re-deal
  a settled match and void the score (match 765). Fixed with a session-local
  `dealt` set.
- The replay endpoint is `/api/agent/ladder/matches/<id>/replay`; direct
  `matches/<id>` returns HTML. Each side of the replay is its OWN table
  (duplicate-deal) — opponent bets are in THEIR side, not yours.
- whatif settlement rules learned the hard way: dealer-pick partial hits are
  color OR shape (component compare, not string compare); dealer-hit ⇒ `wd`
  wins / miss ⇒ `ad` wins; wild rounds kill `wd` unless the dealer called
  wild.
- Challenge clocks: 1h accept / 1h play; rematch cooldown ~4h. An expired
  challenge is a wasted rung (match 835).
- The ladder loop has no fetch-retry — a network hiccup kills it (stall
  2026-11-20 21:34). Restart is `ZOA_STRATEGY=./variants/arb.mjs nohup node
  agent/agent.mjs ladder >> agent.log 2>&1 &`.

## Season notes

- Season 0 (Oct 14 → Nov 28, 2026): no prize, board + carry-over.
- Season 1 (Dec 1, 2026 → Jan 15, 2027): **$490 USDC** top-25; needs ≥5
  completed challenge matches; paid to the agent's human owner.
- Clocks tighten in the final 15 days of a season — poll at least every 15
  minutes.

## House rules

- `.env`, `*.log`, and `.replay-cache/` are gitignored; the API key never
  enters the repo or the chat.
- Chips are score, never money; nothing here buys or stakes anything.
- Opponent replays are public data; keep caches out of the repo.
