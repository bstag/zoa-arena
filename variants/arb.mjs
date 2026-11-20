/* Variant: pokka-style + endgame Dutch book.
   When ALL remaining cards can be covered by mutually exclusive bets at
   Σ(1/multiplier) ≤ 1, stake proportional to 1/multiplier — the round is
   then a GUARANTEED multiplier of 1/Σ, no matter which card comes:
     deckLeft 8, all exacts: Σ = 0.8 → x1.25 riskless
     deckLeft 4, all exacts: Σ = 0.4 → x2.5 riskless
     deckLeft 2, exact+wild: Σ = 0.1+0.2 = 0.3 → x3.33 riskless
     deckLeft 1, exact:      Σ = 0.1 → x10 riskless
   The deck order is NOT known (a lesson from hunt-172: the remaining SET is
   known, the order is not — a single-line all-in there is a coin flip).
   Dutching covers every outcome, so order doesn't matter.
   Everything before deckLeft ~8 stays pokka-style.

   A/B: node sim/simulate.mjs --seeds 400 --strategy ./variants/arb.mjs */
import * as base from "../agent/strategy.mjs";
import * as pokka from "./pokka-style.mjs";

export const COLORS = base.COLORS, SHAPES = base.SHAPES, MIN_BET = base.MIN_BET;
export const probabilities = base.probabilities, payout = base.payout, payoutFor = base.payoutFor;
export const dealerSplit = base.dealerSplit, edges = base.edges, stake = base.stake;
export const dealerPick = pokka.dealerPick;

function stakeFull(ev, p, tokens) {
  if (tokens < base.MIN_BET) return 0;
  if (p >= 1) return tokens;
  if (ev <= 0.02) return 0;
  const b = Math.max(1, (ev + (1 - p)) / (p || 1e-9));
  const f = Math.min(0.5, Math.max(0.05, ev / b));
  return Math.max(base.MIN_BET, Math.min(tokens, Math.round((tokens * f) / 5) * 5));
}

/** Dutch book over every remaining card when the coverage cost fits the stack. */
export function endgameDutch(g) {
  const left = base.remaining(g.history);
  const n = g.deckLeft;
  if (n < 2 || n > 10) return null;
  const cards = [];
  for (const [zone, v] of Object.entries(left)) {
    if (v <= 0) continue;
    const b = zone === "wild" ? 5 : 10;
    cards.push({ zone, b });
  }
  if (cards.length !== n) return null;                 // sanity
  const cost = cards.reduce((t, c) => t + 1 / c.b, 0);
  if (cost >= 1) return null;                          // can't cover the whole deck
  const tokens = g.players[g.you].tokens;
  return cards.map((c) => ({
    zone: c.zone,
    amount: Math.max(base.MIN_BET, Math.floor((tokens * (1 / c.b) / cost) / 5) * 5),
  }));
}

export function bets(g) {
  const dutch = endgameDutch(g);
  if (dutch) return dutch;
  const me = g.players[g.you];
  const lines = base.edges(g).filter((e) => stakeFull(e.ev, e.p, me.tokens) >= base.MIN_BET).slice(0, 4);
  let budget = me.tokens;
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
