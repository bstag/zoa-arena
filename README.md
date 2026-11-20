# zoa-arena — Blackstag's Intuition Game agent + offline bench

Everything an agent needs to play and improve at **The Intuition Game**
(Zoa Games Agent Arena, <https://play.zoagames.com/arena/>): a 19-card deck
(16 unique color/character cards + 3 wilds), revealed one at a time, never
reshuffled. Bet on exact cards (10x), colours/characters (2x), wilds (5x, 10x
when the dealer called wild), or with/against the dealer (1x). Most chips after
19 rounds wins; ladder matches deal both agents the identical deck.

Plain ESM JavaScript — node 18+, no build step.

## Layout

```
agent/strategy.mjs   the whole brain: deck counting, EV pricing, half-Kelly sizing
agent/agent.mjs      plumbing: socket play + the ladder loop (join/defend/deal/challenge)
sim/simulate.mjs     offline A/B bench: replays the documented provably-fair shuffle
analysis/regret.mjs  post-match audit: reconstructs the deck from the published seed
                     and diffs our decisions against ex-post perfect play
variants/            alternative strategies for A/B runs
```

## Setup

```
cp .env.example .env        # paste your IN2IT_API_KEY (never commit this file)
node agent/agent.mjs        # ladder loop: defend, deal, challenge up
node agent/agent.mjs practice
```

Register an agent first (needs a human account + invite code):
`POST /api/agent/register {"inviteCode":"AGT-...","name":"YourAgent"}` — the key
is shown once; store it in `.env`.

## The learning loop

1. **Offline A/B** — thousands of synthetic games, zero API cost:
   `node sim/simulate.mjs --seeds 300 --strategy ./variants/full-kelly.mjs`
2. **Ship the winner** into `agent/strategy.mjs`, restart the agent.
3. **Post-match audit** — every settled ladder match publishes its deck seed:
   `node analysis/regret.mjs <matchId>` reconstructs the exact deck, replays our
   decisions, and reports: negative-EV bets made, +EV rounds sat out, undersized
   bets, dealer sizing, and total ex-ante edge vs realized.
4. Feed the misses back into the strategy. The simulator has *verified shuffle
   parity* with the live server (reproduced a real replay card-for-card), so
   what wins offline wins online.

## What the strategy knows

- Deck counting is exact: `p(zone) = cardsLeft / deckLeft`.
- **Early rounds have no positive-EV bets** — the edge lives in the last third
  of the deck, when exact cards hit 10-50% at 10x. Sit out, don't bleed.
- The **dealer's four-way pick is structurally +EV** (10x exact + 2x colour +
  2x character + 5x wild-auto) — every dealer round is an edge round.
- Wild bets pay **10x, not 5x, when the dealer called wild** — check the rider
  before pricing.
- `wd`/`ad` are priced from the dealer's actual pick, not treated as generic.
- Sizing is **half-Kelly** (`f = EV/odds ÷ 2`, capped 30% per line, 50% total);
  certainty (last card known) goes all-in on the exact 10x.

## Season notes

- Season 0 (Oct 14 → Nov 28, 2026): no prize, board + carry-over.
- Season 1 (Dec 1, 2026 → Jan 15, 2027): **$490 USDC** top-25; needs 5 completed
  challenge matches; paid to the agent's human owner.
- Clocks tighten in the final 15 days of a season (1h accept / 1h play) — poll
  at least every 15 minutes.

## House rules

- `.env` and `*.log` are gitignored; the API key never goes in the repo.
- Chips are score, never money; nothing here buys or stakes anything.
