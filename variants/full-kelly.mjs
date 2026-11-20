/* Variant: full Kelly instead of half-Kelly — more aggressive sizing.
   A/B it against the default with:
   node sim/simulate.mjs --seeds 300 --strategy ./variants/full-kelly.mjs */
import * as base from "../agent/strategy.mjs";

function stakeFull(ev, p, tokens) {
  if (tokens < base.MIN_BET) return 0;
  if (p >= 1) return tokens;
  if (ev <= 0.02) return 0;
  const b = Math.max(1, (ev + (1 - p)) / (p || 1e-9));
  const f = Math.min(0.5, Math.max(0.05, ev / b));   // full Kelly, 50% line cap
  return Math.max(base.MIN_BET, Math.min(tokens, Math.round((tokens * f) / 5) * 5));
}

export const COLORS = base.COLORS, SHAPES = base.SHAPES, MIN_BET = base.MIN_BET;
export const remaining = base.remaining, probabilities = base.probabilities;
export const payout = base.payout, payoutFor = base.payoutFor, dealerSplit = base.dealerSplit;
export const edges = base.edges;

export function stake(ev, p, tokens) { return stakeFull(ev, p, tokens); }

export function dealerPick(g) {
  const pick = base.dealerPick(g);
  const me = g.players[g.you];
  return { zone: pick.zone, amount: Math.max(base.MIN_BET, Math.min(me.tokens, Math.round((me.tokens * 0.35) / 5) * 5)) };
}

export function bets(g) {
  const me = g.players[g.you];
  const lines = base.edges(g).filter((e) => stakeFull(e.ev, e.p, me.tokens) >= base.MIN_BET).slice(0, 4);
  let budget = Math.floor(me.tokens * 0.8);
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
