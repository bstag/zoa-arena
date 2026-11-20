/* Variant: "pokka-style" — the sizing profile reverse-engineered from
   pokka-agent's 493k run against us in match 759.
   - Dealer rounds: the mandatory pick is structurally +EV (wins ~53% at
     blended odds) — stake 75% of the stack instead of hiding at 5%.
   - Player lines: FULL Kelly (no halving), up to 4 lines, 50% per line.
   - Certainty (last card known): all-in on the exact 10x.
   Variance is survivable: you can never bust, the min bet is 5.

   A/B: node sim/simulate.mjs --seeds 300 --strategy ./variants/pokka-style.mjs */
import * as base from "../agent/strategy.mjs";

export const COLORS = base.COLORS, SHAPES = base.SHAPES, MIN_BET = base.MIN_BET;
export const remaining = base.remaining, probabilities = base.probabilities;
export const payout = base.payout, payoutFor = base.payoutFor, dealerSplit = base.dealerSplit;
export const edges = base.edges, stake = base.stake;

function stakeFull(ev, p, tokens) {
  if (tokens < base.MIN_BET) return 0;
  if (p >= 1) return tokens;
  if (ev <= 0.02) return 0;
  const b = Math.max(1, (ev + (1 - p)) / (p || 1e-9));
  const f = Math.min(0.5, Math.max(0.05, ev / b));     // full Kelly
  return Math.max(base.MIN_BET, Math.min(tokens, Math.round((tokens * f) / 5) * 5));
}

export function dealerPick(g) {
  const pick = base.dealerPick(g);                     // zone choice: best four-way EV
  const me = g.players[g.you];
  const amount = Math.max(base.MIN_BET, Math.min(me.tokens, Math.round((me.tokens * 0.75) / 5) * 5));
  return { zone: pick.zone, amount };
}

export function bets(g) {
  const me = g.players[g.you];
  const lines = base.edges(g).filter((e) => stakeFull(e.ev, e.p, me.tokens) >= base.MIN_BET).slice(0, 4);
  let budget = me.tokens;                              // no half-stack budget cap
  const out = [];
  for (const line of lines) {
    let amount = stakeFull(line.ev, line.p, me.tokens);
    if (line.p >= 1) { out.length = 0; out.push({ zone: line.zone, amount: me.tokens }); break; }
    amount = Math.min(amount, Math.max(0, budget));
    if (amount < base.MIN_BET) continue;
    budget -= amount;
    out.push({ zone: line.zone, amount });
    if (budget < base.MIN_BET) break;
  }
  return out;
}
